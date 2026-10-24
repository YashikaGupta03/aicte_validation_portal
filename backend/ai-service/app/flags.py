from __future__ import annotations

from typing import Optional

from .schemas import Evidence, Flag


def make_flag(
    stage: str,
    type_: str,
    severity: str,
    reason: str,
    *,
    confidence: float = 0.6,
    doc_id: Optional[str] = None,
    filename: Optional[str] = None,
    page: Optional[int] = None,
    bbox: Optional[list[float]] = None,
) -> Flag:
    return Flag(
        stage=stage,  # type: ignore[arg-type]
        type=type_,
        severity=severity,  # type: ignore[arg-type]
        reason=reason,
        evidence=Evidence(document=filename, page=page, bbox=bbox),
        confidence=round(max(0.0, min(1.0, confidence)), 2),
        doc_id=doc_id,
    )
