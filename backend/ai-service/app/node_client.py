"""Calls back into the Node API: file download, progress, duplicate lookup, mock authorities."""
from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from typing import Any, Optional

import httpx

from . import config
from .schemas import DocumentRef

log = logging.getLogger("node_client")
HEADERS = {"x-service-token": config.SERVICE_TOKEN}


def _allowed(url: Optional[str]) -> bool:
    """The service token is sent with every request, so only URLs under the Node API are fetched."""
    prefixes = config.ALLOWED_URL_PREFIXES or [config.NODE_API_URL]
    return bool(url) and any(url == p or url.startswith(p + "/") for p in prefixes)


def download(doc: DocumentRef, dest_dir: str) -> str:
    """Download one file; verify its sha256 against what Node stored, so we analyse exactly what was uploaded."""
    if not _allowed(doc.download_url):
        raise ValueError(f"download URL for {doc.filename} is not under an allowed address")
    path = os.path.join(dest_dir, doc.id + (".pdf" if doc.mime == "application/pdf" else ".img"))
    h = hashlib.sha256()
    limit = config.MAX_DOWNLOAD_MB * 1024 * 1024
    size = 0
    with httpx.stream("GET", doc.download_url, headers=HEADERS, timeout=60) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_bytes():
                size += len(chunk)
                if size > limit:
                    raise ValueError(f"{doc.filename} exceeds {config.MAX_DOWNLOAD_MB} MB")
                h.update(chunk)
                f.write(chunk)
    if doc.sha256 and h.hexdigest() != doc.sha256:
        raise ValueError(f"Checksum mismatch for {doc.filename}")
    return path


def report_progress(url: Optional[str], run: int, done: int, total: int, stage: str) -> None:
    if not url or not _allowed(url):
        return
    try:
        httpx.post(url, json={"run": run, "done": done, "total": total, "stage": stage}, headers=HEADERS, timeout=5)
    except Exception as exc:  # progress is cosmetic, never fail the analysis for it
        log.warning("progress callback failed: %s", exc)


def find_duplicates(sha256: Optional[str], phash: Optional[str], application_id: str) -> dict[str, list[dict[str, Any]]]:
    try:
        r = httpx.get(
            f"{config.NODE_API_URL}/internal/duplicates",
            params={"sha256": sha256 or "", "phash": phash or "", "application_id": application_id},
            headers=HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.warning("duplicate lookup failed: %s", exc)
        return {"exact": [], "similar": []}


class SourceUnavailable(Exception):
    pass


def lookup_authority(source: str, ref: str) -> Optional[dict[str, Any]]:
    """Returns the record, None if the source has no such reference. Raises SourceUnavailable if unreachable."""
    try:
        r = httpx.get(f"{config.NODE_API_URL}/mock-authority/{source}", params={"ref": ref}, headers=HEADERS, timeout=8)
    except httpx.HTTPError as exc:
        raise SourceUnavailable(str(exc)) from exc
    if r.status_code == 404:
        return None
    if r.status_code >= 500:
        raise SourceUnavailable(f"HTTP {r.status_code}")
    r.raise_for_status()
    return r.json()


def make_workdir() -> tempfile.TemporaryDirectory:
    return tempfile.TemporaryDirectory(prefix="analysis_")
