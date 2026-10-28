"""Vision LLM wrapper: JSON only, validated with pydantic, one retry if malformed.

Providers (LLM_PROVIDER): "gemini" (default, plain REST via httpx, no extra SDK) or "anthropic".
With no API key for the chosen provider, available() is False and the pipeline falls back to OCR + regex.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from . import config

log = logging.getLogger("llm")
T = TypeVar("T", bound=BaseModel)

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"  # Google recommends 3.x Flash for new projects; override with LLM_MODEL
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class LLMUnavailable(Exception):
    pass


def provider() -> str:
    return "anthropic" if config.LLM_PROVIDER == "anthropic" else "gemini"


def model_name() -> str:
    m = config.LLM_MODEL
    if provider() == "gemini":
        return m if m.startswith("gemini") else DEFAULT_GEMINI_MODEL  # ignores a leftover claude-* value
    return m if m and not m.startswith("gemini") else DEFAULT_ANTHROPIC_MODEL


def available() -> bool:
    return bool(config.GEMINI_API_KEY if provider() == "gemini" else config.ANTHROPIC_API_KEY)


# ---- Gemini ---------------------------------------------------------------------------------------------
def _call_gemini(system: str, user_text: str, images_png: list[bytes]) -> str:
    parts: list[dict] = [{"inlineData": {"mimeType": "image/png", "data": base64.b64encode(i).decode()}} for i in images_png]
    parts.append({"text": user_text})
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0, "maxOutputTokens": 4096},
    }
    # The key goes in a header, not the URL, so it never shows up in logs.
    resp = httpx.post(GEMINI_URL.format(model=model_name()), json=body, headers={"x-goog-api-key": config.GEMINI_API_KEY}, timeout=config.LLM_TIMEOUT_S)
    if resp.status_code >= 400:
        raise RuntimeError(f"Gemini API error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    cands = data.get("candidates") or []
    if not cands:
        raise ValueError(f"Gemini returned no candidates (blocked or empty): {str(data.get('promptFeedback'))[:200]}")
    return "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))


# ---- Anthropic (optional; needs `pip install anthropic`) -----------------------------------------------
_anthropic_client = None


def _call_anthropic(system: str, user_text: str, images_png: list[bytes]) -> str:
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic  # imported lazily so the service starts without the SDK installed

        _anthropic_client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    content: list[dict] = [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(i).decode()}} for i in images_png]
    content.append({"type": "text", "text": user_text})
    msg = _anthropic_client.messages.create(model=model_name(), max_tokens=1200, system=system, messages=[{"role": "user", "content": content}])
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


def _call(system: str, user_text: str, images_png: list[bytes]) -> str:
    if not available():
        raise LLMUnavailable(f"No API key set for provider '{provider()}'")
    return (_call_gemini if provider() == "gemini" else _call_anthropic)(system, user_text, images_png)


def _parse(raw: str, model: Type[T]) -> T:
    text = raw.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in reply")
    return model.model_validate(json.loads(text[start : end + 1]))


def ask_json(system: str, prompt: str, images_png: list[bytes], model: Type[T]) -> T:
    system = system + "\nReply with a single JSON object only. No prose, no markdown fences."
    raw = _call(system, prompt, images_png)
    try:
        return _parse(raw, model)
    except (ValueError, ValidationError, json.JSONDecodeError) as first:
        log.warning("LLM returned malformed JSON, retrying once: %s", first)
        retry_prompt = (
            "Your previous reply was not valid for the required schema. "
            f"Schema: {json.dumps(model.model_json_schema())}. Reply again with only the corrected JSON object."
        )
        raw2 = _call(system, prompt + "\n\n" + retry_prompt, images_png)
        return _parse(raw2, model)  # a second failure propagates; callers fall back