import os

NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:4000").rstrip("/")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN", "dev-service-token-change-me")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5-5")
OCR_ENGINE = os.getenv("OCR_ENGINE", "paddle")
RENDER_DPI = int(os.getenv("RENDER_DPI", "150"))
MAX_PAGES_PER_DOC = int(os.getenv("MAX_PAGES_PER_DOC", "4"))
MAX_DOWNLOAD_MB = int(os.getenv("MAX_DOWNLOAD_MB", "20"))
RULESET_VERSION = "2026.10-v1"
