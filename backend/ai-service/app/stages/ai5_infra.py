"""AI 5: infrastructure check. A vision LLM compares each photo or floor plan to its requirement.
Advisory only: the result is ok / needs_more_evidence / needs_inspection, never a pass or fail."""
from __future__ import annotations

import io
import logging

from .. import llm
from ..flags import make_flag
from ..schemas import DocumentRef, Flag, InfraOutcome, InfraRequirement, LLMInfra
from .common import Page

log = logging.getLogger("ai5")

SYSTEM = (
    "You assist an AICTE officer who reviews infrastructure evidence submitted by colleges. "
    "Describe only what is clearly visible. Image judgement is unreliable, so be conservative: "
    "use 'ok' only when the requirement is plainly satisfied, 'needs_more_evidence' when the image is unclear, "
    "incomplete or does not show the requirement, and 'needs_inspection' when it suggests a shortfall that needs a site visit. "
    "Counts of objects (for example workstations) must be stated as what you can actually count."
)
LOW_CONFIDENCE = 0.6
MIN_SHARPNESS = 60.0     # variance of the Laplacian; below this the photo is probably blurry
MIN_BRIGHTNESS, MAX_BRIGHTNESS = 45.0, 230.0


def photo_quality_problems(png: bytes, is_plan: bool = False) -> list[str]:
    """Cheap heuristics, advisory only. Floor plans are mostly white line drawings, so the
    brightness test is skipped for them."""
    import numpy as np
    from PIL import Image

    gray = np.asarray(Image.open(io.BytesIO(png)).convert("L"), dtype=np.float32)
    problems: list[str] = []
    lap = gray[1:-1, 1:-1] * 4 - gray[:-2, 1:-1] - gray[2:, 1:-1] - gray[1:-1, :-2] - gray[1:-1, 2:]
    if float(lap.var()) < MIN_SHARPNESS:
        problems.append("looks blurry or out of focus")
    if not is_plan:
        mean = float(gray.mean())
        if mean < MIN_BRIGHTNESS:
            problems.append("is too dark")
        elif mean > MAX_BRIGHTNESS:
            problems.append("is overexposed")
    return problems


def assess(ref: DocumentRef, page: Page, req: InfraRequirement) -> InfraOutcome:
    try:
        problems = photo_quality_problems(page.png, is_plan="plan" in req.key.lower() or "plan" in req.label.lower())
    except Exception as exc:
        log.warning("photo quality check failed for %s: %s", ref.filename, exc)
        problems = []
    if problems:  # no point asking the model to judge an unusable photo
        return InfraOutcome(doc_id=ref.id, requirement_key=req.key, requirement=req.requirement, visible="Photo quality problem: the image " + " and ".join(problems) + ". Please upload a clearer photo.", result="needs_more_evidence", confidence=0.0)
    if not llm.available():
        return InfraOutcome(doc_id=ref.id, requirement_key=req.key, requirement=req.requirement, visible="Vision model not configured; no automated assessment was made.", result="needs_more_evidence", confidence=0.0)
    try:
        r = llm.ask_json(
            SYSTEM,
            f"Requirement: {req.requirement}\nReturn JSON: {{\"visible\": str, \"appears_to_meet\": true|false|null, \"result\": \"ok\"|\"needs_more_evidence\"|\"needs_inspection\", \"confidence\": number 0-1}}",
            [page.png],
            LLMInfra,
        )
        result = r.result
        if result == "ok" and (r.confidence < LOW_CONFIDENCE or r.appears_to_meet is not True):
            result = "needs_more_evidence"  # never report ok on low confidence
        return InfraOutcome(doc_id=ref.id, requirement_key=req.key, requirement=req.requirement, visible=r.visible[:600], appears_to_meet=r.appears_to_meet, result=result, confidence=round(r.confidence, 2))
    except Exception as exc:
        log.warning("infra assessment failed for %s: %s", ref.filename, exc)
        return InfraOutcome(doc_id=ref.id, requirement_key=req.key, requirement=req.requirement, visible="The automated assessment could not be completed.", result="needs_more_evidence", confidence=0.0)


def run_infra(refs: dict[str, DocumentRef], pages: dict[str, list[Page]], requirements: list[InfraRequirement]) -> tuple[list[InfraOutcome], list[Flag]]:
    outcomes: list[InfraOutcome] = []
    flags: list[Flag] = []
    by_key = {r.key: r for r in requirements}
    uploaded = set()
    for doc_id, ref in refs.items():
        req = by_key.get(ref.key)
        if ref.kind != "infrastructure" or not req or not pages.get(doc_id):
            continue
        uploaded.add(ref.key)
        out = assess(ref, pages[doc_id][0], req)
        outcomes.append(out)
        if out.result != "ok":
            sev = "medium" if out.result == "needs_inspection" else "low"
            label = "needs a site inspection" if out.result == "needs_inspection" else "needs more evidence"
            flags.append(make_flag("ai5", f"infrastructure_{out.result}", sev, f"{req.label}: {label}. {out.visible}"[:400], confidence=max(out.confidence, 0.3), doc_id=ref.id, filename=ref.filename, page=1))
    for req in requirements:
        if req.key not in uploaded:
            flags.append(make_flag("ai5", "infrastructure_evidence_missing", "low", f"No photo or plan was added for: {req.label}", confidence=1.0))
    return outcomes, flags
