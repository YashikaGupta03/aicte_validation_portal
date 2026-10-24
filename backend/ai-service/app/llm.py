"""Vision LLM wrapper: JSON only, validated with pydantic, one retry if malformed.

Swap point: to use Gemini instead of Claude, replace _call() and keep ask_json() as it is.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Optional, Type, TypeVar

from pydantic import BaseModel, ValidationError

from . import config

log = logging.getLogger("llm")
T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(Exception):
    pass


_client = None


def available() -> bool:
    return bool(config.ANTHROPIC_API_KEY)


def _get_client():
    global _client
    if _client is None:
        if not available():
            raise LLMUnavailable("ANTHROPIC_API_KEY is not set")
        import anthropic  # imported lazily so the service starts without the SDK configured

        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


def _call(system: str, user_text: str, images_png: list[bytes]) -> str:
    content: list[dict] = []
    for img in images_png:
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(img).decode()}})
    content.append({"type": "text", "text": user_text})
    messages = [{"role": "user", "content": content}]
    msg = _get_client().messages.create(model=config.LLM_MODEL, max_tokens=1200, system=system, messages=messages)
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


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
