# ai-service changes (2026-10-28 review)

Reviewed against the workflow document; the Node contract (`POST /analyze`, `x-service-token`, response shape) is unchanged.

- **AI 3, ELA on PDFs:** ELA now runs on pictures embedded in a PDF (scans, pasted stamps) and maps the region back onto the rendered page, instead of on the lossless page render. Uploaded images behave as before. Small edits under about 3 blocks of 32 px are not detected; ELA stays one weak signal among several.
- **AI 3, photo reuse:** infrastructure photos now get a pHash record, so a photo reused in another application is found by `/internal/duplicates`. Previously only checklist documents were hashed.
- **AI 4:** a signature that is not `valid`, or whose DocMDP policy is violated, now counts as invalid (before only `intact` was checked). QR reference mismatches and invalid signatures already set status `mismatch` and raise a high flag.
- **AI 5:** blurry, dark or overexposed photos are answered `needs_more_evidence` with the reason, without calling the model. Floor plans skip the brightness test.
- **OCR:** default is `auto`: Paddle first, Tesseract when Paddle fails or its mean confidence is below `OCR_MIN_CONFIDENCE`. OCR now runs behind a lock (Paddle is not thread-safe and the Node worker runs two jobs at once).
- **Security:** the service token is only sent to URLs under `NODE_API_URL` (or `ALLOWED_URL_PREFIXES`); the service refuses to start with the default `SERVICE_TOKEN` when `NODE_ENV=production`.
- **Compatibility:** PyMuPDF is imported as `pymupdf` with a fallback to `fitz`.
- **Packaging:** pinned requirements, `requirements-dev.txt`, Dockerfile installs `libgomp1`, pre-downloads Paddle models, adds a health check.
- **Tests:** `tests/test_hardening.py` (OCR fallback, photo quality, ELA mapping, signatures, URL safety). Run `pip install -r requirements-dev.txt && pytest -q`.
