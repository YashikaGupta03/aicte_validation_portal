# AICTE validation platform: backend (SIH PS 26261)

Backend for the workflow document. Pairs with the React frontend in `aicte_validation_portal/frontend`.

```
backend/      Node.js + Express + MongoDB (GridFS) + BullMQ: API, auth, queue worker, audit log, mock authorities
ai-service/   Python + FastAPI: the five AI steps behind one endpoint, POST /analyze
docker-compose.yml
```

## Run with Docker
```
cp .env.example .env              # set JWT_SECRET and SERVICE_TOKEN to random values
docker compose up --build
docker compose exec api node src/seed/seed.js     # demo users, checklist, mock NAAC/NBA/AICTE records
```
API on http://localhost:4000. Start the frontend with `npm run dev` (http://localhost:5173).

## Run without Docker
```
# needs MongoDB and Redis running locally
cd backend && cp .env.example .env && npm install && npm run seed && RUN_WORKER_IN_API=true npm run dev
cd ai-service && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
SERVICE_TOKEN=dev-service-token-change-me uvicorn app.main:app --port 8000
```
Linux needs `libzbar0` and `tesseract-ocr` for QR reading and the OCR backup. Without `ANTHROPIC_API_KEY` the AI
service still runs: it uses OCR text and regex for extraction, and infrastructure results become `needs_more_evidence`.

Demo logins after seeding: `admin@demo.local / Admin@12345`, `officer@demo.local / Officer@12345`,
`college@demo.local / College@12345`. Local development only.

## How an application moves (matches the workflow doc)
1. `POST /api/applications` creates a draft, `PATCH` autosaves the form, `PUT .../documents/:key` and `.../infrastructure/:key` upload to GridFS (type sniffed from file content, SHA-256 stored).
2. `POST /api/applications/:id/submit` assigns `APP-2026-00412`-style code, loads the category checklist, records missing documents, enqueues a BullMQ job.
3. The worker calls `POST /analyze` on the AI service, which downloads the files (checksum verified) and runs:
   - AI 1 OCR (Paddle, Tesseract backup) + vision LLM, JSON validated with pydantic, one retry. Each field keeps page and bbox.
   - AI 2 missing / expired / incomplete (plain code), rapidfuzz name matching, comparison with AICTE records.
   - AI 3 ELA, PDF metadata, text layer vs OCR, pHash + SHA-256 duplicates across applications, logical checks. Signals are combined; wording is always "possible".
   - AI 4 QR (pyzbar), digital signatures (pyHanko), mock issuing-authority lookup. One status per document from the six statuses.
   - AI 5 vision check against the infrastructure requirement: `ok` / `needs_more_evidence` / `needs_inspection`, never pass/fail.
4. Results are stored as flags (the workflow's JSON shape), verifications and infrastructure results. Officers are emailed. Status becomes `ready_for_review`.
5. Officers review each flag (`PATCH /api/officer/flags/:id`), then decide (`POST /api/officer/applications/:id/decision`). The server refuses a decision while any flag is still open, and only the `officer` role can decide. No code path approves or rejects automatically.

## Endpoints used by the frontend screens
| Screen | Endpoints |
| --- | --- |
| Sign up / sign in | `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me` |
| College dashboard | `GET /api/applications/dashboard` (stats, list, checklist progress, notifications) |
| New application | `POST /api/applications`, `PATCH /api/applications/:id`, `PUT /api/applications/:id/documents/:key`, `PUT .../infrastructure/:key`, `GET /api/applications/:id`, `POST .../submit` |
| Officer dashboard | `GET /api/officer/queue?stage=needs_review\|in_progress\|decided`, `GET /api/officer/stats` |
| Application report | `GET /api/officer/applications/:id/report`, `GET /api/documents/:id/file` |
| Admin | `GET /api/admin/overview`, `/users`, `/users/:id/approve`, `/checklists/:category`, `/sources`, `/audit`, `/audit/verify` |

Frontend note: the existing screens are static. Add a small `api.js` that stores the JWT, sends `Authorization: Bearer <token>`,
and set a Vite proxy (`server.proxy: {"/api": "http://localhost:4000"}`) or `CORS_ORIGIN`.

## Safeguards built in
- JWT + role checks on every route; accounts are re-read per request so disabling a user takes effect immediately. Officer/admin sign-ups always wait for admin approval.
- Append-only, hash-chained audit log (`GET /api/admin/audit/verify` detects edits or deletions). Logged: uploads, submission with rules applied, every verification (source, time, outcome), file views by staff, flag reviews, decisions, admin changes.
- `/internal/*` and `/mock-authority/*` need the shared `SERVICE_TOKEN`; do not expose them through a public proxy. The production start refuses default secrets.
- The AI service never fetches URLs found in QR codes. QR content is used only as a reference number.
- Mock authorities are clearly separate (`routes/mockAuthority.js`); replace with real integrations only where authorised.

## Known limits (be upfront in the pitch)
- Written without a live MongoDB, Redis or internet, so it has been syntax- and import-checked but **not run end to end**. Expect small fixes on first start. `ai-service/tests` (`pytest`) cover the rule logic and are the first thing to run.
- ELA and metadata signals are weak on scans; that is why they are combined and never labelled "forged". Measure them on your synthetic set of 30 to 50 documents.
- Mongo audit append-only is enforced in the app. For stronger guarantees give the app's DB user insert-only rights on `auditlogs`.
- Documents without a configured source (affidavit, land record, structural certificate) get `manual_review`. Edit `SOURCE_FOR_DOC` in `ai4_verify.py` when sources exist.
- Reference-number patterns in checklists are Python regexes; keep them simple.
