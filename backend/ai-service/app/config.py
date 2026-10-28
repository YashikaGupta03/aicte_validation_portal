import os

NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:4000").rstrip("/")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN", "dev-service-token-change-me")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5-5")
OCR_ENGINE = os.getenv("OCR_ENGINE", "auto")  # auto | paddle | tesseract | none
OCR_MIN_CONFIDENCE = float(os.getenv("OCR_MIN_CONFIDENCE", "0.5"))  # auto: below this mean confidence, retry with Tesseract
# Only files and callbacks under these URL prefixes are fetched (the service token is sent with every call).
ALLOWED_URL_PREFIXES = [p.strip().rstrip("/") for p in os.getenv("ALLOWED_URL_PREFIXES", "").split(",") if p.strip()]
RENDER_DPI = int(os.getenv("RENDER_DPI", "150"))
MAX_PAGES_PER_DOC = int(os.getenv("MAX_PAGES_PER_DOC", "4"))
MAX_DOWNLOAD_MB = int(os.getenv("MAX_DOWNLOAD_MB", "20"))
RULESET_VERSION = "2026.10-v2"
DEFAULT_SERVICE_TOKEN = "dev-service-token-change-me"
if os.getenv("NODE_ENV") == "production" and SERVICE_TOKEN == DEFAULT_SERVICE_TOKEN:
    raise RuntimeError("Refusing to start in production with the default SERVICE_TOKEN")
