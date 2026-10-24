"""Unit tests for the deterministic parts. Run: pytest -q  (from ai-service/)"""
from datetime import date

from app.schemas import AnalyzeRequest, ExtractedDocument, ExtractedField
from app.stages.ai2_validate import compare_names, run_validation
from app.stages.ai3_anomaly import Signal, combine
from app.stages.common import name_similarity, parse_date


def req(**over):
    base = {
        "application_id": "a1", "run": 1, "category": "Extension of Approval", "submission_date": "2026-10-23",
        "form": {"institution_name": "Government Engineering College", "address": "Plot 14, Knowledge Park", "proposed_intake": 240, "previous_approval_ref": "AICTE/APR/2025/0412"},
        "checklist": {"version": 1, "documents": [
            {"key": "fire_certificate", "label": "Fire safety certificate", "required": True, "must_be_valid_on_submission": True, "required_fields": ["institution_name", "expiry_date"]},
            {"key": "noc", "label": "NOC", "required": True, "required_fields": []},
        ]},
        "documents": [{"id": "d1", "kind": "checklist", "key": "fire_certificate", "filename": "fire.pdf", "mime": "application/pdf", "download_url": "http://x"}],
    }
    base.update(over)
    return AnalyzeRequest(**base)


def doc(**fields):
    return ExtractedDocument(doc_id="d1", doc_key="fire_certificate", fields=[ExtractedField(name=k, value=v) for k, v in fields.items()])


def fake_authority(source, ref):
    return {"institution": "Government Engineering College", "approvedIntake": 180, "terStatus": "paid"}


def types(flags):
    return {f.type for f in flags}


def test_abbreviations_match():
    assert name_similarity("Govt. Engg College", "Government Engineering College") == 100
    assert compare_names("Govt. Engg College", "Government Engineering College") == "match"


def test_different_college_is_mismatch():
    assert compare_names("Riverside Polytechnic", "Government Engineering College") == "mismatch"


def test_date_parsing_day_first():
    assert parse_date("05/11/2026") == date(2026, 11, 5)
    assert parse_date("not a date") is None


def test_missing_and_expired():
    flags = run_validation(req(), {"d1": doc(institution_name="Government Engineering College", expiry_date="2026-09-01")}, {"d1": "fire.pdf"}, today=date(2026, 10, 24), authority=fake_authority)
    assert "missing_document" in types(flags)  # NOC was not uploaded
    assert "expired_document" in types(flags)  # expired before the submission date


def test_valid_document_has_no_expiry_flag():
    flags = run_validation(req(), {"d1": doc(institution_name="Government Engineering College", expiry_date="2027-09-01")}, {"d1": "fire.pdf"}, today=date(2026, 10, 24), authority=fake_authority)
    assert "expired_document" not in types(flags)


def test_incomplete_and_name_mismatch():
    flags = run_validation(req(), {"d1": doc(institution_name="Some Other Institute")}, {"d1": "fire.pdf"}, today=date(2026, 10, 24), authority=fake_authority)
    assert {"incomplete_document", "name_mismatch"} <= types(flags)


def test_issue_after_application_date():
    flags = run_validation(req(), {"d1": doc(institution_name="Government Engineering College", issue_date="2026-11-30", expiry_date="2027-11-30")}, {"d1": "fire.pdf"}, today=date(2026, 10, 24), authority=fake_authority)
    assert "date_mismatch" in types(flags)


def test_intake_above_approved_and_unpaid_ter():
    unpaid = lambda s, r: {"institution": "Government Engineering College", "approvedIntake": 180, "terStatus": "unpaid"}
    flags = run_validation(req(), {"d1": doc(institution_name="Government Engineering College", expiry_date="2027-09-01")}, {"d1": "fire.pdf"}, today=date(2026, 10, 24), authority=unpaid)
    assert {"ter_unpaid", "intake_exceeds_approved"} <= types(flags)


def test_every_flag_needs_human_review():
    flags = run_validation(req(), {}, {}, today=date(2026, 10, 24), authority=fake_authority)
    assert flags and all(f.needs_human_review for f in flags)


def test_combined_score_needs_agreement():
    one = combine([Signal("ela", 0.8, "x")])
    two = combine([Signal("ela", 0.8, "x"), Signal("metadata_dates", 1.0, "y")])
    assert one < 0.6 <= two
