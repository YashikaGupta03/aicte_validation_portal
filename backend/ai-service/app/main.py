import hmac
import logging

from fastapi import Depends, FastAPI, Header, HTTPException

from . import config
from .pipeline import analyze
from .schemas import AnalyzeRequest, AnalyzeResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = FastAPI(title="AICTE validation AI service", version="0.1.0")


def require_service_token(x_service_token: str = Header(default="")) -> None:
    if not hmac.compare_digest(x_service_token.encode(), config.SERVICE_TOKEN.encode()):
        raise HTTPException(status_code=401, detail="Bad service token")


@app.get("/health")
def health():
    return {"ok": True}


# Sync endpoint: FastAPI runs it in a worker thread, so OCR and image work do not block the event loop.
@app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Depends(require_service_token)])
def analyze_endpoint(req: AnalyzeRequest) -> AnalyzeResponse:
    return analyze(req)
