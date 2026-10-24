"""AI 3: anomaly signals. Several simple signals are scored and combined; results always say "possible",
never "forged". Everything here is advisory."""
from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from rapidfuzz import fuzz

from ..flags import make_flag
from ..node_client import find_duplicates
from ..schemas import DocumentRef, ExtractedDocument, Flag
from .common import Page, parse_date

log = logging.getLogger("ai3")

EDITING_TOOLS = re.compile(r"photoshop|illustrator|canva|ilovepdf|smallpdf|sejda|pdfescape|phantom|pdf-xchange|gimp|online2pdf|pdfcandy|nitro|pixlr", re.I)
SIGNAL_WEIGHTS = {"ela": 0.5, "metadata_tool": 0.3, "metadata_dates": 0.5, "text_layer": 0.6, "duplicate": 0.7, "id_mismatch": 0.8}


@dataclass
class Signal:
    name: str
    score: float  # 0-1
    reason: str
    page: Optional[int] = None
    bbox: Optional[list[float]] = None


def combine(signals: list[Signal]) -> float:
    """1 - prod(1 - weight*score): independent weak signals add up, one weak signal alone stays low."""
    p = 1.0
    for s in signals:
        p *= 1 - SIGNAL_WEIGHTS.get(s.name, 0.4) * max(0.0, min(1.0, s.score))
    return round(1 - p, 2)


# ---- signal 1: Error Level Analysis ---------------------------------------------------------------------
def ela_signal(page: Page, quality: int = 90, block: int = 32) -> Optional[Signal]:
    """Re-save as JPEG and look for blocks whose compression error stands out from the rest of the page.
    Weak on its own (scans and photos are noisy), so it is only ever one input to the combined score."""
    import numpy as np
    from PIL import Image

    img = Image.open(io.BytesIO(page.png)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    re_saved = Image.open(buf).convert("RGB")
    diff = np.abs(np.asarray(img, dtype=np.float32) - np.asarray(re_saved, dtype=np.float32)).mean(axis=2)
    gh, gw = diff.shape[0] // block, diff.shape[1] // block
    if gh < 4 or gw < 4:
        return None
    blocks = diff[: gh * block, : gw * block].reshape(gh, block, gw, block).mean(axis=(1, 3))
    med = float(np.median(blocks))
    mad = float(np.median(np.abs(blocks - med))) * 1.4826 + 1e-3
    hot = ((blocks - med) / mad > 6) & (blocks > med + 1.5)
    n_hot = int(hot.sum())
    if n_hot < 3:
        return None
    frac = n_hot / hot.size
    if frac > 0.4:  # most of the page is "different": noisy scan, not a local edit
        return None
    ys, xs = np.where(hot)
    bbox = [float(xs.min() * block), float(ys.min() * block), float((xs.max() + 1) * block), float((ys.max() + 1) * block)]
    score = min(1.0, 0.3 + frac * 8)
    return Signal("ela", score, "Possible edited region: compression error differs from the rest of the page", page.number, bbox)


# ---- signal 2: PDF / image metadata ---------------------------------------------------------------------
def _pdf_date(s: Optional[str]) -> Optional[datetime]:
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?", s or "")
    if not m:
        return None
    y, mo, d, h, mi, se = (int(x) if x else 0 for x in m.groups())
    try:
        return datetime(y, mo, d, h, mi, se)
    except ValueError:
        return None


def metadata_signals(path: str, mime: str, issue_iso: Optional[str]) -> list[Signal]:
    out: list[Signal] = []
    software = ""
    created = modified = None
    try:
        if mime == "application/pdf":
            import fitz

            with fitz.open(path) as doc:
                md = doc.metadata or {}
            software = f"{md.get('producer', '')} {md.get('creator', '')}"
            created, modified = _pdf_date(md.get("creationDate")), _pdf_date(md.get("modDate"))
        else:
            from PIL import Image

            ex = Image.open(path).getexif()
            software = str(ex.get(305, ""))
    except Exception as exc:
        log.warning("metadata read failed: %s", exc)
        return out

    if software and EDITING_TOOLS.search(software):
        out.append(Signal("metadata_tool", 0.6, f"File metadata shows image or PDF editing software ({software.strip()[:60]})"))
    if created and modified and (modified - created).days >= 1:
        out.append(Signal("metadata_dates", 0.4, f"File was modified {(modified - created).days} day(s) after it was created"))
    issue = parse_date(issue_iso)
    if created and issue and (issue - created.date()).days > 1:
        out.append(Signal("metadata_dates", 0.8, f"File creation date ({created.date()}) is before the stated issue date ({issue})"))
    return out


# ---- signal 3: visible text vs OCR ----------------------------------------------------------------------
def text_layer_signal(pages: list[Page]) -> Optional[Signal]:
    layer = re.sub(r"\W+", " ", " ".join(p.layer_text for p in pages)).lower().strip()
    ocr = re.sub(r"\W+", " ", " ".join(p.ocr_text for p in pages)).lower().strip()
    if len(layer) < 200 or len(ocr) < 200:
        return None  # nothing meaningful to compare (scan, or OCR did not run)
    ratio = fuzz.token_set_ratio(layer, ocr)
    if ratio < 60:
        return Signal("text_layer", min(1.0, (70 - ratio) / 40 + 0.4), f"Hidden text layer differs from what is visible on the page (similarity {ratio:.0f}%)")
    return None


def phash_hex(page: Page) -> Optional[str]:
    try:
        import imagehash
        from PIL import Image

        return str(imagehash.phash(Image.open(io.BytesIO(page.png)).convert("L")))
    except Exception as exc:
        log.warning("phash failed: %s", exc)
        return None


def run_anomaly(
    application_id: str,
    refs: dict[str, DocumentRef],
    paths: dict[str, str],
    pages: dict[str, list[Page]],
    extracted: dict[str, ExtractedDocument],
) -> list[Flag]:
    flags: list[Flag] = []
    per_doc: dict[str, list[Signal]] = {doc_id: [] for doc_id in refs}

    seen_sha: dict[str, str] = {}
    for doc_id, ref in refs.items():
        ex, pgs = extracted.get(doc_id), pages.get(doc_id, [])
        if not pgs:
            continue
        if ex:
            ex.phash = phash_hex(pgs[0])
        sigs = per_doc[doc_id]

        for p in pgs:
            if p.has_raster:
                try:
                    s = ela_signal(p)
                    if s:
                        sigs.append(s)
                        break  # one ELA finding per document is enough
                except Exception as exc:
                    log.warning("ELA failed for %s: %s", ref.filename, exc)
        sigs += metadata_signals(paths[doc_id], ref.mime, ex.get("issue_date").value if ex and ex.get("issue_date") else None)
        tl = text_layer_signal(pgs)
        if tl:
            sigs.append(tl)

        # same file uploaded under two checklist items in this application
        if ref.sha256:
            if ref.sha256 in seen_sha:
                flags.append(make_flag("ai3", "duplicate_within_application", "medium", f"Possible duplicate: '{ref.filename}' is identical to the file uploaded as {seen_sha[ref.sha256]}", confidence=0.9, doc_id=doc_id, filename=ref.filename))
            seen_sha[ref.sha256] = ref.key

        dup = find_duplicates(ref.sha256, ex.phash if ex else None, application_id)
        for d in dup.get("exact", []):
            flags.append(make_flag("ai3", "duplicate_document", "high" if not d.get("sameOwner") else "low", f"Identical file also appears in {d.get('applicationCode') or 'another application'} ({d.get('key')}). Check whether the reuse is legitimate.", confidence=0.9, doc_id=doc_id, filename=ref.filename))
            sigs.append(Signal("duplicate", 1.0 if not d.get("sameOwner") else 0.2, "duplicate"))
        for d in dup.get("similar", []):
            flags.append(make_flag("ai3", "similar_document", "medium", f"Page looks nearly identical to a document in {d.get('applicationCode') or 'another application'} ({d.get('key')})", confidence=0.6, doc_id=doc_id, filename=ref.filename))
            sigs.append(Signal("duplicate", 0.5, "similar"))

    # logical: the same ID printed differently on two documents
    ids: dict[str, tuple[str, str]] = {}
    for doc_id, ex in extracted.items():
        f = ex.get("aicte_id")
        if f:
            norm = re.sub(r"[^A-Z0-9]", "", f.value.upper())
            for other_norm, (other_doc, _) in ids.items():
                if other_norm != norm:
                    flags.append(make_flag("ai3", "id_mismatch", "high", f"AICTE ID '{f.value}' differs from the ID on {refs[other_doc].filename}", confidence=0.85, doc_id=doc_id, filename=refs[doc_id].filename, page=f.page, bbox=f.bbox))
                    per_doc[doc_id].append(Signal("id_mismatch", 1.0, "id"))
            ids.setdefault(norm, (doc_id, f.value))

    # per-signal flags, then one combined flag when several signals agree
    for doc_id, sigs in per_doc.items():
        ref = refs[doc_id]
        for s in sigs:
            if s.name in ("duplicate", "id_mismatch"):
                continue  # already flagged above
            sev = "medium" if s.score >= 0.6 else "low"
            flags.append(make_flag("ai3", f"possible_{s.name}", sev, s.reason, confidence=0.3 + 0.5 * s.score, doc_id=doc_id, filename=ref.filename, page=s.page, bbox=s.bbox))
        total = combine(sigs)
        if total >= 0.6 and len({s.name for s in sigs}) >= 2:
            flags.append(make_flag("ai3", "possible_tampering", "high" if total >= 0.8 else "medium", f"Several signals together suggest this document may have been altered ({', '.join(sorted({s.name for s in sigs}))}). Officer review needed.", confidence=total, doc_id=doc_id, filename=ref.filename))
    return flags
