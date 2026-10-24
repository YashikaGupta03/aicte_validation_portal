"""Runs the five AI steps in order. A crash in one step becomes an explicit flag, so a silent gap never
looks like a clean result."""
from __future__ import annotations

import logging
from typing import Callable

from . import config, llm
from .flags import make_flag
from .node_client import download, make_workdir, report_progress
from .schemas import AnalyzeRequest, AnalyzeResponse, DocumentRef, ExtractedDocument, Flag, InfraOutcome, Verification
from .stages import ai1_extract, ai2_validate, ai3_anomaly, ai4_verify, ai5_infra
from .stages.common import Page, render_pages, run_ocr

log = logging.getLogger("pipeline")
TOTAL_STEPS = 5


def _guard(label: str, stage: str, flags: list[Flag], fn: Callable, default):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        log.exception("%s failed", label)
        flags.append(make_flag(stage, "automated_step_failed", "medium", f"Automated step '{label}' could not run ({type(exc).__name__}). Check this application manually.", confidence=1.0))
        return default


def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    flags: list[Flag] = []
    progress = lambda done, stage: report_progress(req.callback.progress_url, req.run, done, TOTAL_STEPS, stage)

    with make_workdir() as tmp:
        refs: dict[str, DocumentRef] = {}
        paths: dict[str, str] = {}
        for ref in req.documents:
            try:
                paths[ref.id] = download(ref, tmp)
                refs[ref.id] = ref
            except Exception as exc:  # noqa: BLE001
                log.warning("download failed for %s: %s", ref.filename, exc)
                flags.append(make_flag("ai1", "unreadable_file", "high", f"{ref.filename} could not be read or its checksum did not match", confidence=1.0, doc_id=ref.id, filename=ref.filename))

        # ---- AI 1: read documents
        pages: dict[str, list[Page]] = {}
        extracted: dict[str, ExtractedDocument] = {}
        labels = {c.key: c.label for c in req.checklist.documents}

        def step1():
            for doc_id, ref in refs.items():
                try:
                    pgs = render_pages(paths[doc_id], ref.mime)
                except Exception as exc:  # noqa: BLE001
                    flags.append(make_flag("ai1", "unreadable_file", "high", f"{ref.filename} could not be opened ({type(exc).__name__}). It may be corrupt or password protected.", confidence=1.0, doc_id=ref.id, filename=ref.filename))
                    continue
                pages[doc_id] = pgs
                if ref.kind == "checklist":
                    engine = run_ocr(pgs)
                    extracted[doc_id] = ai1_extract.extract(ref, pgs, engine, labels.get(ref.key, ref.key))

        _guard("read documents", "ai1", flags, step1, None)
        progress(1, "read documents")

        # ---- AI 2: validate and compare
        names = {r.id: r.filename for r in refs.values()}
        flags += _guard("validate and compare", "ai2", flags, lambda: ai2_validate.run_validation(req, extracted, names), [])
        progress(2, "validate and compare")

        # ---- AI 3: anomalies (checklist documents only; photos get ELA through the same path)
        flags += _guard("detect anomalies", "ai3", flags, lambda: ai3_anomaly.run_anomaly(req.application_id, {i: r for i, r in refs.items() if i in pages}, paths, pages, extracted), [])
        progress(3, "detect anomalies")

        # ---- AI 4: verification
        verifications: list[Verification] = []
        v_result = _guard("verify with issuing authority", "ai4", flags, lambda: ai4_verify.run_verification(refs, paths, pages, extracted), ([], []))
        verifications, v_flags = v_result
        flags += v_flags
        progress(4, "verify with issuing authority")

        # ---- AI 5: infrastructure
        infra: list[InfraOutcome] = []
        i_result = _guard("infrastructure check", "ai5", flags, lambda: ai5_infra.run_infra(refs, pages, req.checklist.infrastructure), ([], []))
        infra, i_flags = i_result
        flags += i_flags
        progress(5, "infrastructure check")

    return AnalyzeResponse(
        application_id=req.application_id, run=req.run, ruleset=f"{config.RULESET_VERSION}/llm={'on' if llm.available() else 'off'}",
        documents=list(extracted.values()), flags=flags, verifications=verifications, infrastructure=infra,
    )
