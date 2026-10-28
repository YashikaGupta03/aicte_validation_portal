"""Shared helpers: page rendering, OCR, date parsing, name normalisation."""
from __future__ import annotations

import io
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from dateutil import parser as dateparser
from rapidfuzz import fuzz

from .. import config

try:  # PyMuPDF 1.24+ exposes "pymupdf"; older and some newer releases only "fitz"
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz  # type: ignore[no-redef]

log = logging.getLogger("common")


@dataclass
class OcrLine:
    text: str
    bbox: list[float]  # x0, y0, x1, y1 in rendered page pixels
    conf: float = 0.0


@dataclass
class Page:
    number: int  # 1-based
    png: bytes
    width: int
    height: int
    lines: list[OcrLine] = field(default_factory=list)
    ocr_text: str = ""  # from the OCR engine (empty if no engine ran)
    layer_text: str = ""  # embedded PDF text layer (empty for images / scans)
    has_raster: bool = False  # page contains embedded images (relevant for ELA)

    @property
    def text(self) -> str:
        return self.ocr_text or self.layer_text


# ---- rendering -----------------------------------------------------------------------------------------
def render_pages(path: str, mime: str) -> list[Page]:
    if mime == "application/pdf":
        pages: list[Page] = []
        with fitz.open(path) as doc:
            for i in range(min(len(doc), config.MAX_PAGES_PER_DOC)):
                p = doc[i]
                pix = p.get_pixmap(dpi=config.RENDER_DPI)
                scale = config.RENDER_DPI / 72
                page = Page(i + 1, pix.tobytes("png"), pix.width, pix.height, layer_text=p.get_text() or "", has_raster=bool(p.get_images()))
                # words from the text layer give accurate boxes when no OCR engine is available
                words = p.get_text("words")
                by_line: dict[tuple[int, int], list] = {}
                for w in words:
                    by_line.setdefault((w[5], w[6]), []).append(w)
                for ws in by_line.values():
                    ws.sort(key=lambda w: w[7])
                    page.lines.append(
                        OcrLine(" ".join(w[4] for w in ws), [min(w[0] for w in ws) * scale, min(w[1] for w in ws) * scale, max(w[2] for w in ws) * scale, max(w[3] for w in ws) * scale], 1.0)
                    )
                pages.append(page)
        return pages
    from PIL import Image

    img = Image.open(path).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return [Page(1, buf.getvalue(), img.width, img.height, has_raster=True)]


# ---- OCR -----------------------------------------------------------------------------------------------
_paddle = None


def _paddle_engine():
    global _paddle
    if _paddle is None:
        from paddleocr import PaddleOCR

        _paddle = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    return _paddle


def _ocr_paddle(png: bytes) -> list[OcrLine]:
    import numpy as np
    from PIL import Image

    arr = np.array(Image.open(io.BytesIO(png)).convert("RGB"))
    result = _paddle_engine().ocr(arr, cls=True)
    out: list[OcrLine] = []
    for line in (result[0] if result and result[0] else []):
        box, (text, conf) = line
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        out.append(OcrLine(text, [min(xs), min(ys), max(xs), max(ys)], float(conf)))
    return out


def _ocr_tesseract(png: bytes) -> list[OcrLine]:
    import pytesseract
    from PIL import Image

    d = pytesseract.image_to_data(Image.open(io.BytesIO(png)), output_type=pytesseract.Output.DICT)
    groups: dict[tuple, list[int]] = {}
    for i, t in enumerate(d["text"]):
        if t.strip() and float(d["conf"][i]) > 0:
            groups.setdefault((d["block_num"][i], d["par_num"][i], d["line_num"][i]), []).append(i)
    out = []
    for idx in groups.values():
        out.append(
            OcrLine(
                " ".join(d["text"][i] for i in idx),
                [min(d["left"][i] for i in idx), min(d["top"][i] for i in idx), max(d["left"][i] + d["width"][i] for i in idx), max(d["top"][i] + d["height"][i] for i in idx)],
                sum(float(d["conf"][i]) for i in idx) / len(idx) / 100,
            )
        )
    return out


_ocr_lock = threading.Lock()  # PaddleOCR is not thread-safe and FastAPI runs requests in a thread pool


def _mean_conf(lines: list[OcrLine]) -> float:
    return sum(l.conf for l in lines) / len(lines) if lines else 0.0


def run_ocr(pages: list[Page]) -> str:
    """Fills page.lines / ocr_text. Returns the engine that was actually used.

    auto      -> Paddle per document; if it fails or its mean confidence is low, Tesseract is used instead
    paddle    -> Paddle, Tesseract if Paddle raises
    tesseract -> Tesseract only
    none      -> skip OCR (PDF text layer only)
    """
    mode = config.OCR_ENGINE if config.OCR_ENGINE in ("auto", "paddle", "tesseract", "none") else "auto"
    order = {"auto": ["paddle", "tesseract"], "paddle": ["paddle", "tesseract"], "tesseract": ["tesseract"], "none": []}[mode]
    for engine in order:
        try:
            fn = _ocr_paddle if engine == "paddle" else _ocr_tesseract
            with _ocr_lock:
                results = [fn(p.png) for p in pages]
            if mode == "auto" and engine == "paddle":
                all_lines = [l for r in results for l in r]
                if _mean_conf(all_lines) < config.OCR_MIN_CONFIDENCE:
                    log.warning("Paddle confidence %.2f is low; trying Tesseract", _mean_conf(all_lines))
                    continue
            for p, lines in zip(pages, results):
                p.lines, p.ocr_text = lines, "\n".join(l.text for l in lines)
            return engine
        except Exception as exc:
            log.warning("OCR engine %s failed (%s)", engine, exc)
    if any(p.layer_text for p in pages):
        for p in pages:
            p.ocr_text = ""  # keep layer_text separate, so anomaly checks know no real OCR ran
        return "pdf_text_layer"
    return "none"


# ---- parsing helpers -----------------------------------------------------------------------------------
DATE_RE = re.compile(
    r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\b"
)


def parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", s.strip()):
            return datetime.strptime(s.strip(), "%Y-%m-%d").date()
        return dateparser.parse(s, dayfirst=True, fuzzy=False).date()
    except (ValueError, OverflowError, TypeError):
        return None


ABBREVIATIONS = {
    "govt": "government", "gov": "government", "engg": "engineering", "eng": "engineering", "inst": "institute",
    "instt": "institute", "tech": "technology", "technol": "technology", "coll": "college", "univ": "university",
    "poly": "polytechnic", "mgmt": "management", "dept": "department", "&": "and", "st": "street", "rd": "road",
}


def normalize_name(s: str) -> str:
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(ABBREVIATIONS.get(t, t) for t in s.split())


def name_similarity(a: str, b: str) -> float:
    """0-100. 'Govt. Engg College' vs 'Government Engineering College' scores 100."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    return (fuzz.token_sort_ratio(na, nb) + fuzz.token_set_ratio(na, nb)) / 2


def locate(value: str, pages: list[Page]) -> tuple[Optional[int], Optional[list[float]]]:
    """Find which page and box a value came from, so the dashboard can highlight it."""
    best, best_score = (None, None), 0.0
    v = value.lower()
    for p in pages:
        for line in p.lines:
            if v in line.text.lower():
                return p.number, [round(x, 1) for x in line.bbox]
            score = fuzz.partial_ratio(v, line.text.lower())
            if score > best_score:
                best, best_score = (p.number, [round(x, 1) for x in line.bbox]), score
    return best if best_score >= 88 else (None, None)
