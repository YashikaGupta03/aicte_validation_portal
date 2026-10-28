FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# tesseract: OCR fallback | libzbar0: QR codes | libgl1, libglib2.0-0, libgomp1: OpenCV and PaddlePaddle
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr libzbar0 libgl1 libglib2.0-0 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

# pyclipper 1.4.0 crashes on import in this image (zlib error); use the last known-good release.
# Placed after the big pip layer so that layer stays cached.
RUN pip install --force-reinstall --no-deps --no-cache-dir "pyclipper==1.3.0.post6"

RUN useradd -m svc && chown -R svc /srv
COPY --chown=svc app ./app
USER svc

# Download the PaddleOCR models at build time so the first analysis is not slow.
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='en', show_log=False); print('PADDLE_OK')" || echo "PADDLE_WARMUP_FAILED: service will fall back to Tesseract"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
    CMD curl -fs http://127.0.0.1:8000/health || exit 1
# One worker: OCR runs behind a lock and models are loaded once per process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]