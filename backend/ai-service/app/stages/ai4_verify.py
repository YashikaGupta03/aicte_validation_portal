"""AI 4: verify with the issuing authority. QR code and digital signature checks, then a lookup against the
(mock) issuing-authority API. One status per document, with source, timestamp and outcome for the audit log.

Security note: QR contents are only used as a reference number. The service never fetches a URL found in a
QR code (that would let an uploaded document make this server call arbitrary addresses)."""
from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime, timezone
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

from ..flags import make_flag
from ..node_client import SourceUnavailable, lookup_authority
from ..schemas import DocumentRef, ExtractedDocument, Flag, Verification
from .common import Page, name_similarity, parse_date

log = logging.getLogger("ai4")

# Which mock authority holds which document. Edit this map when real sources are connected.
SOURCE_FOR_DOC = {"noc": "university", "fire_certificate": "fire", "ter_receipt": "aicte"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def source_for(doc_key: str, ex: Optional[ExtractedDocument]) -> Optional[str]:
    if doc_key == "accreditation":
        text = f"{ex.doc_type if ex else ''} {ex.get('reference_number').value if ex and ex.get('reference_number') else ''}".upper()
        return "nba" if "NBA" in text else "naac"
    return SOURCE_FOR_DOC.get(doc_key)


# ---- QR ------------------------------------------------------------------------------------------------
def read_qr(pages: list[Page]) -> list[str]:
    payloads: list[str] = []
    for p in pages[:2]:
        try:
            from PIL import Image

            img = Image.open(io.BytesIO(p.png)).convert("RGB")
            try:
                from pyzbar.pyzbar import decode

                payloads += [d.data.decode("utf-8", "ignore") for d in decode(img) if d.type == "QRCODE"]
            except ImportError:
                import cv2
                import numpy as np

                text, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR))
                if text:
                    payloads.append(text)
        except Exception as exc:
            log.warning("QR scan failed on page %s: %s", p.number, exc)
    return list(dict.fromkeys(payloads))


def reference_from_qr(payload: str) -> Optional[str]:
    payload = payload.strip()
    if re.match(r"^https?://", payload, re.I):
        u = urlparse(payload)
        q = parse_qs(u.query)
        for k in ("ref", "id", "no", "cert", "certificate", "number"):
            if k in q and q[k]:
                return q[k][0][:100]
        tail = u.path.rstrip("/").split("/")[-1]
        return tail[:100] or None
    return payload[:100] or None


# ---- signatures ----------------------------------------------------------------------------------------
def check_signatures(path: str) -> dict[str, Any]:
    out: dict[str, Any] = {"present": False, "signatures": []}
    try:
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import validate_pdf_signature

        with open(path, "rb") as f:
            for sig in PdfFileReader(f).embedded_signatures:
                out["present"] = True
                try:
                    st = validate_pdf_signature(sig)  # no trust roots configured: integrity is checked, trust is not
                    out["signatures"].append({"field": sig.field_name, "intact": bool(st.intact), "valid": bool(st.valid),
                                              "trusted": bool(st.trusted), "docmdp_ok": st.docmdp_ok})
                except Exception as exc:
                    out["signatures"].append({"field": sig.field_name, "intact": False, "valid": False, "trusted": False, "error": str(exc)[:120]})
    except Exception as exc:
        out["error"] = str(exc)[:120]
    return out


def _norm_ref(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def verify_document(ref: DocumentRef, path: str, pages: list[Page], ex: Optional[ExtractedDocument], *, today: Optional[date] = None, authority=lookup_authority) -> tuple[Verification, list[Flag]]:
    today = today or date.today()
    flags: list[Flag] = []
    details: dict[str, Any] = {}

    qr_payloads = read_qr(pages)
    qr_ref = reference_from_qr(qr_payloads[0]) if qr_payloads else None
    details["qr_found"] = bool(qr_payloads)
    if qr_payloads:
        details["qr_payload"] = qr_payloads[0][:200]
    sig = check_signatures(path) if ref.mime == "application/pdf" else {"present": False, "signatures": []}
    details["digital_signature"] = sig

    def result(status: str, source: str) -> tuple[Verification, list[Flag]]:
        return Verification(doc_id=ref.id, document_key=ref.key, status=status, source=source, checked_at=_now(), details=details), flags  # type: ignore[arg-type]

    if sig["present"] and any(not s["intact"] or not s["valid"] or s.get("docmdp_ok") is False for s in sig["signatures"]):
        details["reason"] = "A digital signature is present but the file was changed after signing"
        flags.append(make_flag("ai4", "signature_invalid", "high", f"{ref.filename}: digital signature does not validate. The file may have been changed after signing.", confidence=0.85, doc_id=ref.id, filename=ref.filename))
        return result("mismatch", "pdf_signature")

    printed = ex.get("reference_number").value if ex and ex.get("reference_number") else None
    if printed and qr_ref and _norm_ref(printed) != _norm_ref(qr_ref):
        details.update(reason="Reference printed on the page differs from the QR code", printed=printed, qr=qr_ref)
        flags.append(make_flag("ai4", "qr_reference_mismatch", "high", f"{ref.filename}: printed reference '{printed}' differs from the QR code reference '{qr_ref}'", confidence=0.85, doc_id=ref.id, filename=ref.filename))
        return result("mismatch", "qr_code")

    reference = printed or qr_ref
    source = source_for(ref.key, ex)
    if not source:
        details["reason"] = "No issuing-authority source is configured for this document type"
        return result("manual_review", "none")
    if not reference:
        details["reason"] = "No reference number could be read from the page or QR code"
        return result("manual_review", source)

    details["reference"] = reference
    try:
        rec = authority(source, reference)
    except SourceUnavailable as exc:
        details["reason"] = f"Source could not be reached: {exc}"
        return result("source_unavailable", source)
    if rec is None:
        details["reason"] = "The issuing authority has no record of this reference"
        flags.append(make_flag("ai4", "reference_not_found", "high", f"{ref.filename}: reference '{reference}' was not found at the issuing authority ({source})", confidence=0.8, doc_id=ref.id, filename=ref.filename))
        return result("mismatch", source)

    details["record"] = {k: rec.get(k) for k in ("institution", "validFrom", "validTo", "grade", "status")}
    if rec.get("status") == "pending":
        details["reason"] = "The issuing authority has not completed its own verification yet"
        return result("pending", source)

    problems: list[str] = []
    name = ex.get("institution_name").value if ex and ex.get("institution_name") else None
    if name and rec.get("institution") and name_similarity(name, rec["institution"]) < 80:
        problems.append(f"institution on the document is '{name}', the authority has '{rec['institution']}'")
    printed_expiry = parse_date(ex.get("expiry_date").value) if ex and ex.get("expiry_date") else None
    record_expiry = parse_date(rec.get("validTo"))
    if printed_expiry and record_expiry and printed_expiry != record_expiry:
        problems.append(f"expiry on the document is {printed_expiry}, the authority has {record_expiry}")
    if problems:
        details["differences"] = problems
        flags.append(make_flag("ai4", "verification_mismatch", "high", f"{ref.filename}: details differ from the issuing authority ({'; '.join(problems)})", confidence=0.85, doc_id=ref.id, filename=ref.filename))
        return result("mismatch", source)
    if record_expiry and record_expiry < today:
        details["reason"] = f"The authority's record expired on {record_expiry}"
        return result("expired", source)
    return result("verified", source)


def run_verification(refs: dict[str, DocumentRef], paths: dict[str, str], pages: dict[str, list[Page]], extracted: dict[str, ExtractedDocument]) -> tuple[list[Verification], list[Flag]]:
    verifications: list[Verification] = []
    flags: list[Flag] = []
    for doc_id, ref in refs.items():
        if ref.kind != "checklist" or doc_id not in pages:
            continue
        v, f = verify_document(ref, paths[doc_id], pages[doc_id], extracted.get(doc_id))
        verifications.append(v)
        flags += f
    return verifications, flags
