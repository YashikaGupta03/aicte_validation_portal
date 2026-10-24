"""Request/response models. Every AI step returns flags in the same shape (workflow section 4)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

Severity = Literal["low", "medium", "high"]
VerificationStatus = Literal["verified", "mismatch", "expired", "pending", "source_unavailable", "manual_review"]
InfraResultValue = Literal["ok", "needs_more_evidence", "needs_inspection"]


# ---- request -------------------------------------------------------------------------------------------
class FormData(BaseModel):
    institution_name: str = ""
    academic_year: str = ""
    address: str = ""
    proposed_intake: Optional[int] = None
    previous_approval_ref: str = ""


class ChecklistDoc(BaseModel):
    key: str
    label: str
    required: bool = True
    must_be_valid_on_submission: bool = False
    required_fields: list[str] = Field(default_factory=list)
    reference_pattern: Optional[str] = None


class InfraRequirement(BaseModel):
    key: str
    label: str
    requirement: str


class ChecklistData(BaseModel):
    version: int = 1
    documents: list[ChecklistDoc]
    infrastructure: list[InfraRequirement] = Field(default_factory=list)


class DocumentRef(BaseModel):
    id: str
    kind: Literal["checklist", "infrastructure"]
    key: str
    filename: str
    mime: str
    sha256: Optional[str] = None
    download_url: str


class Callback(BaseModel):
    progress_url: Optional[str] = None


class AnalyzeRequest(BaseModel):
    application_id: str
    application_code: Optional[str] = None
    run: int = 1
    category: str
    submission_date: str  # YYYY-MM-DD
    form: FormData
    checklist: ChecklistData
    documents: list[DocumentRef]
    callback: Callback = Field(default_factory=Callback)


# ---- response ------------------------------------------------------------------------------------------
class Evidence(BaseModel):
    document: Optional[str] = None
    page: Optional[int] = None
    bbox: Optional[list[float]] = None


class Flag(BaseModel):
    stage: Literal["ai1", "ai2", "ai3", "ai4", "ai5"]
    type: str
    severity: Severity
    reason: str
    evidence: Evidence = Field(default_factory=Evidence)
    confidence: float = Field(ge=0, le=1)
    needs_human_review: bool = True
    doc_id: Optional[str] = None

    @model_validator(mode="after")
    def _advisory_only(self):
        # The AI never acts on its own: every flag goes to an officer.
        self.needs_human_review = True
        return self


class ExtractedField(BaseModel):
    name: str
    value: str
    page: Optional[int] = None
    bbox: Optional[list[float]] = None


class ExtractedDocument(BaseModel):
    doc_id: str
    doc_key: str
    doc_type: str = "unknown"
    confidence: float = 0.0
    ocr_engine: str = "none"
    page_count: int = 0
    phash: Optional[str] = None
    fields: list[ExtractedField] = Field(default_factory=list)

    def get(self, name: str) -> Optional[ExtractedField]:
        return next((f for f in self.fields if f.name == name and f.value), None)


class Verification(BaseModel):
    doc_id: str
    document_key: str
    status: VerificationStatus
    source: str
    checked_at: str
    details: dict[str, Any] = Field(default_factory=dict)


class InfraOutcome(BaseModel):
    doc_id: str
    requirement_key: str
    requirement: str
    visible: str
    appears_to_meet: Optional[bool] = None
    result: InfraResultValue
    confidence: float = 0.0


class AnalyzeResponse(BaseModel):
    application_id: str
    run: int
    ruleset: str
    documents: list[ExtractedDocument]
    flags: list[Flag]
    verifications: list[Verification]
    infrastructure: list[InfraOutcome]


# LLM output schema for AI 1 (validated with pydantic, retried once if malformed)
class LLMField(BaseModel):
    name: str
    value: str


class LLMExtraction(BaseModel):
    document_type: str
    confidence: float = Field(ge=0, le=1)
    fields: list[LLMField] = Field(default_factory=list)


class LLMInfra(BaseModel):
    visible: str
    appears_to_meet: Optional[bool] = None
    result: InfraResultValue
    confidence: float = Field(ge=0, le=1)
