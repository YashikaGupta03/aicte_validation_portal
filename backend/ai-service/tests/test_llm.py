import json

import pytest
from pydantic import BaseModel

from app import config, llm


class Out(BaseModel):
    a: int


class FakeResp:
    def __init__(self, status, payload):
        self.status_code, self._p, self.text = status, payload, json.dumps(payload)

    def json(self):
        return self._p


def _reply(text):
    return FakeResp(200, {"candidates": [{"content": {"parts": [{"text": text}]}}]})


@pytest.fixture(autouse=True)
def gemini(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(config, "LLM_MODEL", "claude-sonnet-5-5")  # leftover value must be ignored


def test_available_needs_key(monkeypatch):
    assert llm.available()
    monkeypatch.setattr(config, "GEMINI_API_KEY", "")
    assert not llm.available()


def test_model_ignores_claude_name():
    assert llm.model_name().startswith("gemini")


def test_gemini_request_and_parse(monkeypatch):
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, body=json, headers=headers)
        return _reply('```json\n{"a": 3}\n```')

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    out = llm.ask_json("sys", "hi", [b"\x89PNG"], Out)
    assert out.a == 3
    assert "key" not in seen["url"] and seen["headers"]["x-goog-api-key"] == "test-key"
    assert seen["body"]["contents"][0]["parts"][0]["inlineData"]["mimeType"] == "image/png"


def test_malformed_then_retry(monkeypatch):
    replies = iter([_reply("not json"), _reply('{"a": 1}')])
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: next(replies))
    assert llm.ask_json("s", "p", [], Out).a == 1


def test_http_error_raises(monkeypatch):
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: FakeResp(429, {"error": "quota"}))
    with pytest.raises(RuntimeError):
        llm.ask_json("s", "p", [], Out)
