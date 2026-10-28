"""Tests for OCR fallback, photo quality, embedded-image ELA, signature handling and URL safety.
Run: pytest -q  (from ai-service/)"""
import io
from types import SimpleNamespace

import numpy as np
from PIL import Image

from app import config, node_client
from app.schemas import DocumentRef, ExtractedDocument, ExtractedField
from app.stages import ai3_anomaly, ai4_verify, ai5_infra, common
from app.stages.common import OcrLine, Page


def png(arr) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype("uint8")).save(buf, "PNG")
    return buf.getvalue()


def noisy(h=200, w=300, seed=0):
    return np.random.RandomState(seed).rand(h, w, 3) * 255


def page(n=1):
    return Page(n, png(noisy(40, 60)), 60, 40)


# ---- OCR ------------------------------------------------------------------------------------------------
def test_ocr_auto_uses_paddle_when_confident(monkeypatch):
    monkeypatch.setattr(config, "OCR_ENGINE", "auto")
    monkeypatch.setattr(common, "_ocr_paddle", lambda b: [OcrLine("hello", [0, 0, 1, 1], 0.9)])
    monkeypatch.setattr(common, "_ocr_tesseract", lambda b: [OcrLine("TESS", [0, 0, 1, 1], 0.9)])
    pages = [page()]
    assert common.run_ocr(pages) == "paddle" and pages[0].ocr_text == "hello"


def test_ocr_auto_falls_back_on_low_confidence(monkeypatch):
    monkeypatch.setattr(config, "OCR_ENGINE", "auto")
    monkeypatch.setattr(common, "_ocr_paddle", lambda b: [OcrLine("junk", [0, 0, 1, 1], 0.2)])
    monkeypatch.setattr(common, "_ocr_tesseract", lambda b: [OcrLine("clean", [0, 0, 1, 1], 0.8)])
    pages = [page()]
    assert common.run_ocr(pages) == "tesseract" and pages[0].ocr_text == "clean"


def test_ocr_falls_back_when_paddle_raises(monkeypatch):
    def boom(b):
        raise RuntimeError("paddle missing")

    monkeypatch.setattr(config, "OCR_ENGINE", "auto")
    monkeypatch.setattr(common, "_ocr_paddle", boom)
    monkeypatch.setattr(common, "_ocr_tesseract", lambda b: [OcrLine("clean", [0, 0, 1, 1], 0.8)])
    assert common.run_ocr([page()]) == "tesseract"


def test_ocr_none_when_everything_fails(monkeypatch):
    def boom(b):
        raise RuntimeError("x")

    monkeypatch.setattr(config, "OCR_ENGINE", "auto")
    monkeypatch.setattr(common, "_ocr_paddle", boom)
    monkeypatch.setattr(common, "_ocr_tesseract", boom)
    assert common.run_ocr([page()]) == "none"


# ---- photo quality --------------------------------------------------------------------------------------
def test_quality_sharp_photo_is_fine():
    assert ai5_infra.photo_quality_problems(png(noisy() * 0.5 + 60)) == []


def test_quality_flags_blurry_dark_and_bright():
    assert "looks blurry or out of focus" in ai5_infra.photo_quality_problems(png(np.full((100, 100, 3), 120)))
    assert "is too dark" in ai5_infra.photo_quality_problems(png(noisy() * 0.05))
    assert "is overexposed" in ai5_infra.photo_quality_problems(png(np.full((100, 100, 3), 250)))


def test_quality_skips_brightness_for_floor_plans():
    white_plan = np.full((200, 300, 3), 252.0)
    white_plan[::50, :, :] = 0  # sharp drawn lines
    assert ai5_infra.photo_quality_problems(png(white_plan), is_plan=True) == []
    assert "is overexposed" in ai5_infra.photo_quality_problems(png(white_plan), is_plan=False)


# ---- embedded-image ELA ---------------------------------------------------------------------------------
class FakeRect:
    x0, y0, width, height = 72, 144, 200, 100  # points


class FakePage:
    def get_images(self, full=True):
        return [(7,)]

    def get_image_rects(self, xref):
        return [FakeRect()]


def make_fake_fitz(image_bytes):
    class Doc(list):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_image(self, xref):
            return {"image": image_bytes}

    return SimpleNamespace(open=lambda path: Doc([FakePage()]))


def tampered_png():
    base = noisy(192, 320)
    buf = io.BytesIO()
    Image.fromarray(base.astype("uint8")).save(buf, "JPEG", quality=60)
    img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    img.paste(Image.fromarray((noisy(64, 96, seed=5)).astype("uint8")), (128, 64))  # pasted-in patch
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def test_embedded_image_ela_finds_patch_and_maps_bbox(monkeypatch):
    monkeypatch.setattr(ai3_anomaly, "fitz", make_fake_fitz(tampered_png()))
    pg = page()
    pg.has_raster = True
    sig = ai3_anomaly.embedded_image_ela("x.pdf", [pg])
    assert sig is not None and sig.name == "ela" and sig.page == 1
    scale = config.RENDER_DPI / 72
    # picture is 320x192 px drawn into a 200x100 pt box at (72, 144) pt; the patch starts at (128, 64) px.
    # ELA works in 32 px blocks, so allow one block of slack.
    expect_x = 72 * scale + 128 * (200 * scale / 320)
    expect_y = 144 * scale + 64 * (100 * scale / 192)
    assert abs(sig.bbox[0] - expect_x) < 32 * (200 * scale / 320) + 1
    assert abs(sig.bbox[1] - expect_y) < 32 * (100 * scale / 192) + 1


def test_embedded_image_ela_ignores_pages_without_pictures(monkeypatch):
    monkeypatch.setattr(ai3_anomaly, "fitz", make_fake_fitz(tampered_png()))
    assert ai3_anomaly.embedded_image_ela("x.pdf", [page()]) is None  # has_raster is False


def test_embedded_image_ela_quiet_on_clean_image(monkeypatch):
    buf = io.BytesIO()
    Image.fromarray(noisy(192, 320).astype("uint8")).save(buf, "JPEG", quality=60)
    clean = io.BytesIO()
    Image.open(io.BytesIO(buf.getvalue())).save(clean, "PNG")
    monkeypatch.setattr(ai3_anomaly, "fitz", make_fake_fitz(clean.getvalue()))
    pg = page()
    pg.has_raster = True
    assert ai3_anomaly.embedded_image_ela("x.pdf", [pg]) is None


# ---- AI 4: signatures and QR ----------------------------------------------------------------------------
def ref():
    return DocumentRef(id="d1", kind="checklist", key="fire_certificate", filename="fire.pdf", mime="application/pdf", download_url="http://x")


def ex(**fields):
    return ExtractedDocument(doc_id="d1", doc_key="fire_certificate", fields=[ExtractedField(name=k, value=v) for k, v in fields.items()])


def run_verify(monkeypatch, sigs, qr=None, record=None):
    monkeypatch.setattr(ai4_verify, "read_qr", lambda pages: qr or [])
    monkeypatch.setattr(ai4_verify, "check_signatures", lambda path: {"present": bool(sigs), "signatures": sigs})
    return ai4_verify.verify_document(ref(), "x.pdf", [page()], ex(reference_number="FSC/2026/04417"), authority=lambda s, r: record)


GOOD = {"institution": "X College", "validTo": "2099-01-01"}


def test_signature_that_does_not_validate_is_flagged(monkeypatch):
    v, flags = run_verify(monkeypatch, [{"field": "S", "intact": True, "valid": False, "trusted": False}], record=GOOD)
    assert v.status == "mismatch" and [f.type for f in flags] == ["signature_invalid"]


def test_docmdp_violation_is_flagged(monkeypatch):
    v, flags = run_verify(monkeypatch, [{"field": "S", "intact": True, "valid": True, "trusted": False, "docmdp_ok": False}], record=GOOD)
    assert v.status == "mismatch" and flags[0].type == "signature_invalid"


def test_qr_reference_mismatch_changes_status(monkeypatch):
    v, flags = run_verify(monkeypatch, [], qr=["https://v.example/check?ref=FSC/2026/99999"], record=GOOD)
    assert v.status == "mismatch" and flags[0].type == "qr_reference_mismatch"


def test_good_signature_and_matching_qr_is_verified(monkeypatch):
    v, flags = run_verify(monkeypatch, [{"field": "S", "intact": True, "valid": True, "trusted": False, "docmdp_ok": None}],
                          qr=["FSC/2026/04417"], record={"institution": "x", "validTo": "2099-01-01"})
    assert v.status == "verified" and flags == []


# ---- URL safety -----------------------------------------------------------------------------------------
def test_only_node_api_urls_are_fetched(monkeypatch):
    monkeypatch.setattr(config, "NODE_API_URL", "http://api:4000")
    monkeypatch.setattr(config, "ALLOWED_URL_PREFIXES", [])
    assert node_client._allowed("http://api:4000/internal/files/1")
    assert not node_client._allowed("http://api:4000.evil.com/x")
    assert not node_client._allowed("http://evil.com/internal/files/1")
    assert not node_client._allowed(None)


def test_download_refuses_foreign_url(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "NODE_API_URL", "http://api:4000")
    monkeypatch.setattr(config, "ALLOWED_URL_PREFIXES", [])
    bad = DocumentRef(id="d9", kind="checklist", key="k", filename="f.pdf", mime="application/pdf", download_url="http://evil.com/f")
    try:
        node_client.download(bad, str(tmp_path))
    except ValueError as e:
        assert "allowed" in str(e)
    else:
        raise AssertionError("download should have been refused")
