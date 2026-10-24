"""AI 2: validate and compare. Missing / expired / incomplete checks are plain code (no AI).
Name, address and intake consistency use rapidfuzz. AICTE record comparison uses the mock records API."""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Callable, Optional

from ..flags import make_flag
from ..node_client import SourceUnavailable, lookup_authority
from ..schemas import AnalyzeRequest, ExtractedDocument, Flag
from .common import name_similarity, normalize_name, parse_date
from rapidfuzz import fuzz

log = logging.getLogger("ai2")
NAME_OK, NAME_REVIEW = 92, 75  # >= OK matches; between is "possible variation"; below is a mismatch


def _ev(ex: ExtractedDocument, field: str, filename: str) -> dict:
    f = ex.get(field)
    return {"doc_id": ex.doc_id, "filename": filename, "page": f.page if f else None, "bbox": f.bbox if f else None}


def compare_names(a: str, b: str) -> str:
    s = name_similarity(a, b)
    return "match" if s >= NAME_OK else "variation" if s >= NAME_REVIEW else "mismatch"


def run_validation(
    req: AnalyzeRequest,
    extracted: dict[str, ExtractedDocument],
    filenames: dict[str, str],
    *,
    today: Optional[date] = None,
    authority: Callable = lookup_authority,
) -> list[Flag]:
    today = today or date.today()
    submission = parse_date(req.submission_date) or today
    flags: list[Flag] = []
    by_key = {ex.doc_key: ex for ex in extracted.values()}

    # 1. missing: required document not uploaded
    for cd in req.checklist.documents:
        if cd.required and cd.key not in by_key and not any(d.kind == "checklist" and d.key == cd.key for d in req.documents):
            flags.append(make_flag("ai2", "missing_document", "high", f"Required document not uploaded: {cd.label}", confidence=1.0))

    cd_by_key = {c.key: c for c in req.checklist.documents}
    for ex in extracted.values():
        cd = cd_by_key.get(ex.doc_key)
        fn = filenames.get(ex.doc_id, ex.doc_key)
        if not cd:
            continue
        kw = lambda field: {"doc_id": ex.doc_id, "filename": fn, "page": (ex.get(field).page if ex.get(field) else None), "bbox": (ex.get(field).bbox if ex.get(field) else None)}

        # 2. incomplete: required field not found
        absent = [f for f in cd.required_fields if not ex.get(f)]
        if absent:
            flags.append(make_flag("ai2", "incomplete_document", "medium", f"{cd.label}: could not find {', '.join(a.replace('_', ' ') for a in absent)}", confidence=0.7, doc_id=ex.doc_id, filename=fn))

        issue, expiry = parse_date(ex.get("issue_date").value if ex.get("issue_date") else None), parse_date(ex.get("expiry_date").value if ex.get("expiry_date") else None)
        for fld, parsed in (("issue_date", issue), ("expiry_date", expiry)):
            if ex.get(fld) and parsed is None:
                flags.append(make_flag("ai2", "unreadable_date", "low", f"{cd.label}: {fld.replace('_', ' ')} '{ex.get(fld).value}' could not be read as a date", confidence=0.6, **kw(fld)))

        # 3. expired (valid on submission date where the checklist says so, otherwise valid today)
        if expiry:
            ref_date = submission if cd.must_be_valid_on_submission else today
            if expiry < ref_date:
                flags.append(make_flag("ai2", "expired_document", "high", f"{cd.label} expired on {expiry.isoformat()}" + (" (before the submission date)" if cd.must_be_valid_on_submission else ""), confidence=0.9, **kw("expiry_date")))

        # dates that cannot be right
        if issue and issue > submission:
            flags.append(make_flag("ai2", "date_mismatch", "medium", f"{cd.label} issue date {issue.isoformat()} is after the application date {submission.isoformat()}", confidence=0.85, **kw("issue_date")))
        if issue and expiry and expiry < issue:
            flags.append(make_flag("ai2", "impossible_date", "high", f"{cd.label}: expiry date {expiry.isoformat()} is before the issue date {issue.isoformat()}", confidence=0.9, **kw("expiry_date")))

        # reference format
        ref_field = ex.get("reference_number")
        if cd.reference_pattern and ref_field:
            try:
                if not re.fullmatch(cd.reference_pattern, ref_field.value[:100]):
                    flags.append(make_flag("ai2", "reference_format", "medium", f"{cd.label}: reference number '{ref_field.value}' does not match the expected format", confidence=0.7, **kw("reference_number")))
            except re.error:
                log.warning("bad reference_pattern for %s", cd.key)

        # consistency with the application form
        name = ex.get("institution_name")
        if name and req.form.institution_name:
            verdict = compare_names(name.value, req.form.institution_name)
            if verdict == "mismatch":
                flags.append(make_flag("ai2", "name_mismatch", "high", f"{cd.label}: institution name '{name.value}' does not match the application ('{req.form.institution_name}')", confidence=0.8, **kw("institution_name")))
            elif verdict == "variation":
                flags.append(make_flag("ai2", "name_variation", "low", f"{cd.label}: institution name '{name.value}' differs slightly from the application ('{req.form.institution_name}')", confidence=0.6, **kw("institution_name")))
        addr = ex.get("address")
        if addr and req.form.address and fuzz.token_set_ratio(normalize_name(addr.value), normalize_name(req.form.address)) < 60:
            flags.append(make_flag("ai2", "address_mismatch", "medium", f"{cd.label}: address differs from the application address", confidence=0.65, **kw("address")))
        intake = ex.get("intake")
        if intake and req.form.proposed_intake is not None and intake.value.isdigit() and int(intake.value) != req.form.proposed_intake:
            flags.append(make_flag("ai2", "intake_mismatch", "medium", f"{cd.label}: intake {intake.value} differs from the proposed intake {req.form.proposed_intake}", confidence=0.7, **kw("intake")))

    flags += _aicte_records(req, authority, submission)
    return flags


def _aicte_records(req: AnalyzeRequest, authority: Callable, submission: date) -> list[Flag]:
    ref = (req.form.previous_approval_ref or "").strip()
    if not ref:
        return [make_flag("ai2", "previous_approval_missing", "low", "No previous approval reference was given, so AICTE records could not be compared", confidence=0.9)]
    try:
        rec = authority("aicte", ref)
    except SourceUnavailable:
        return [make_flag("ai2", "aicte_record_unavailable", "low", "AICTE records could not be reached; comparison skipped and needs manual follow-up", confidence=0.9)]
    if rec is None:
        return [make_flag("ai2", "previous_approval_not_found", "medium", f"Previous approval reference '{ref}' was not found in AICTE records", confidence=0.85)]

    out: list[Flag] = []
    if rec.get("institution") and req.form.institution_name and compare_names(rec["institution"], req.form.institution_name) == "mismatch":
        out.append(make_flag("ai2", "name_mismatch", "high", f"AICTE record for {ref} belongs to '{rec['institution']}', not '{req.form.institution_name}'", confidence=0.85))
    if str(rec.get("terStatus", "")).lower() != "paid":
        out.append(make_flag("ai2", "ter_unpaid", "high", f"AICTE records show TER payment status '{rec.get('terStatus', 'unknown')}'", confidence=0.85))
    approved = rec.get("approvedIntake")
    if isinstance(approved, int) and req.form.proposed_intake is not None and req.form.proposed_intake > approved:
        out.append(make_flag("ai2", "intake_exceeds_approved", "medium", f"Proposed intake {req.form.proposed_intake} is above the previously approved intake {approved}", confidence=0.8))
    return out
