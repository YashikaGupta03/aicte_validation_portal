"""AI 1: read documents. OCR with positions, then a vision LLM returns document type + fields as JSON.
Falls back to regex heuristics when no LLM key is configured, so the pipeline always produces something."""
from __future__ import annotations

import logging
import re
from typing import Optional

from .. import llm
from ..schemas import DocumentRef, ExtractedDocument, ExtractedField, LLMExtraction
from .common import DATE_RE, Page, locate, parse_date

log = logging.getLogger("ai1")

FIELD_NAMES = ["institution_name", "issue_date", "expiry_date", "reference_number", "issuing_authority", "address", "intake", "aicte_id", "signatory"]
DATE_FIELDS = {"issue_date", "expiry_date"}

SYSTEM = (
    "You read official Indian institutional approval documents (affidavits, NOCs, fire safety, accreditation, "
    "TER receipts, land records, structural certificates). Extract only what is printed on the document. "
    "If a field is not present, leave it out. Never guess or invent values."
)


def _prompt(expected_label: str, ocr_text: str) -> str:
    return (
        f"The college uploaded this file as: {expected_label}.\n"
        f"Allowed field names: {', '.join(FIELD_NAMES)}.\n"
        "Return JSON: {\"document_type\": str (e.g. affidavit, noc, fire_certificate, accreditation, ter_receipt, land_record, structural_certificate, other), "
        "\"confidence\": number 0-1, \"fields\": [{\"name\": str, \"value\": str}]}.\n"
        "Dates as printed. OCR text of the pages (may contain errors):\n" + ocr_text[:6000]
    )


def _heuristic(pages: list[Page], expected_label: str) -> LLMExtraction:
    text = "\n".join(p.text for p in pages)
    fields: list[dict] = []

    m = re.search(r"(?:institution|institute|college)\s*(?:name)?\s*[:\-]\s*(.+)", text, re.I)
    if m:
        fields.append({"name": "institution_name", "value": m.group(1).strip()[:150]})
    else:
        for line in text.splitlines():
            if re.search(r"\b(institute|college|university|polytechnic)\b", line, re.I) and 8 < len(line) < 120:
                fields.append({"name": "institution_name", "value": line.strip()})
                break

    m = re.search(r"(?:ref(?:erence)?\.?|certificate|letter|receipt|approval)\s*(?:no|number)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-.]{5,})", text, re.I)
    if not m:
        m = re.search(r"\b([A-Z]{2,8}(?:/[A-Z0-9\-]{2,12}){2,})\b", text)
    if m:
        fields.append({"name": "reference_number", "value": m.group(1).strip().rstrip(".")})

    m = re.search(r"AICTE\s*(?:ID|No)\.?\s*[:\-]?\s*([\w\-/]+)", text, re.I)
    if m:
        fields.append({"name": "aicte_id", "value": m.group(1)})
    m = re.search(r"intake[^\d\n]{0,25}(\d{2,4})", text, re.I)
    if m:
        fields.append({"name": "intake", "value": m.group(1)})

    for line in text.splitlines():
        dates = DATE_RE.findall(line)
        if not dates:
            continue
        low = line.lower()
        if re.search(r"valid|expir|upto|up to|till|until", low) and not any(f["name"] == "expiry_date" for f in fields):
            fields.append({"name": "expiry_date", "value": dates[-1]})
        elif re.search(r"issue|dated|date of|date:", low) and not any(f["name"] == "issue_date" for f in fields):
            fields.append({"name": "issue_date", "value": dates[0]})
    if not any(f["name"] == "issue_date" for f in fields):
        first = DATE_RE.search(text)
        if first:
            fields.append({"name": "issue_date", "value": first.group(1)})
    return LLMExtraction(document_type=expected_label, confidence=0.3, fields=fields)


def extract(ref: DocumentRef, pages: list[Page], engine: str, expected_label: str) -> ExtractedDocument:
    ocr_text = "\n".join(f"[page {p.number}]\n{p.text}" for p in pages)
    result: Optional[LLMExtraction] = None
    if llm.available():
        try:
            result = llm.ask_json(SYSTEM, _prompt(expected_label, ocr_text), [p.png for p in pages[:2]], LLMExtraction)
            engine = f"{engine}+llm"
        except Exception as exc:
            log.warning("LLM extraction failed for %s, using heuristics: %s", ref.filename, exc)
    if result is None:
        result = _heuristic(pages, expected_label)

    fields: list[ExtractedField] = []
    seen: set[str] = set()
    for f in result.fields:
        name, value = f.name.strip().lower(), f.value.strip()
        if name not in FIELD_NAMES or not value or name in seen:
            continue
        seen.add(name)
        if name in DATE_FIELDS:
            d = parse_date(value)
            page, bbox = locate(value, pages)
            fields.append(ExtractedField(name=name, value=d.isoformat() if d else value, page=page, bbox=bbox))
            continue
        page, bbox = locate(value, pages)
        fields.append(ExtractedField(name=name, value=value, page=page, bbox=bbox))

    return ExtractedDocument(
        doc_id=ref.id, doc_key=ref.key, doc_type=result.document_type, confidence=round(result.confidence, 2),
        ocr_engine=engine, page_count=len(pages), fields=fields,
    )
