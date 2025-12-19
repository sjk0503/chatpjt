from __future__ import annotations

import json
import os
import re
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"


class GptError(RuntimeError):
    pass


@dataclass(frozen=True)
class GptResponse:
    raw: dict[str, Any]
    output_text: str


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class GptToolResponse:
    raw: dict[str, Any]
    message_text: str
    tool_calls: list[ToolCall]


def _get_api_key() -> str:
    # 프로젝트에서는 backend/.env에 GPT_API로 저장
    key = (os.getenv("GPT_API") or "").strip()
    if not key:
        raise GptError("환경 변수 GPT_API가 설정되어 있지 않습니다.")
    return key


def _extract_output_text(payload: dict[str, Any]) -> str:
    # 일부 Responses 응답은 output_text 편의 필드를 제공한다.
    ot = payload.get("output_text")
    if isinstance(ot, str) and ot.strip():
        return ot.strip()

    # Responses API 형태를 우선 지원.
    # - payload["output"] = [{type:"message", content:[{type:"output_text", text:"..."}]} ...]
    out = payload.get("output")
    if isinstance(out, list):
        chunks: list[str] = []
        for item in out:
            if not isinstance(item, dict):
                continue

            item_type = item.get("type")
            # 일부 모델/버전은 output 항목 자체가 output_text 타입으로 올 수 있다.
            if item_type in ("output_text", "text"):
                t = item.get("text")
                if isinstance(t, str) and t.strip():
                    chunks.append(t.strip())
                continue

            if item_type == "refusal":
                r = item.get("refusal")
                if isinstance(r, str) and r.strip():
                    chunks.append(r.strip())
                continue

            if item_type != "message":
                continue

            # message content는 list[part] 또는 드물게 string일 수 있다.
            content = item.get("content")
            if isinstance(content, str) and content.strip():
                chunks.append(content.strip())
                continue

            if isinstance(content, list):
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    c_type = c.get("type")
                    if c_type in ("output_text", "text"):
                        text = c.get("text")
                        if isinstance(text, str) and text.strip():
                            chunks.append(text.strip())
                        elif isinstance(text, dict):
                            val = text.get("value") or text.get("text")
                            if isinstance(val, str) and val.strip():
                                chunks.append(val.strip())
                    elif c_type == "refusal":
                        refusal = c.get("refusal")
                        if isinstance(refusal, str) and refusal.strip():
                            chunks.append(refusal.strip())
        if chunks:
            return "\n".join(chunks).strip()

    # Chat Completions 형태(레거시)도 최소 지원.
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else None
        if isinstance(first, dict):
            # legacy text field
            if isinstance(first.get("text"), str) and first.get("text").strip():
                return first.get("text").strip()

            msg = first.get("message")
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str) and content.strip():
                    return content.strip()
                # 최신 형태: content가 parts 배열일 수 있다.
                if isinstance(content, list):
                    parts: list[str] = []
                    for p in content:
                        if not isinstance(p, dict):
                            continue
                        if p.get("type") == "text":
                            t = p.get("text")
                            if isinstance(t, str) and t.strip():
                                parts.append(t.strip())
                        elif isinstance(p.get("text"), dict):
                            val = p["text"].get("value") or p["text"].get("text")
                            if isinstance(val, str) and val.strip():
                                parts.append(val.strip())
                    if parts:
                        return "\n".join(parts).strip()
    return ""


def _logger() -> logging.Logger:
    # uvicorn 기본 로거를 사용하면 별도 설정 없이도 출력되는 경우가 많습니다.
    return logging.getLogger("uvicorn.error")


def _debug_enabled() -> bool:
    return str(os.getenv("GPT_DEBUG") or "").lower() in ("1", "true", "yes", "y")


def _safe_json_preview(payload: dict[str, Any], limit: int = 1200) -> str:
    try:
        raw = json.dumps(payload, ensure_ascii=False)
    except Exception:
        return "<unserializable>"
    return raw[:limit] + ("..." if len(raw) > limit else "")


def _debug_log(msg: str) -> None:
    if _debug_enabled():
        # 환경에 따라 info가 보이지 않는 경우가 있어 warning으로 찍는다.
        _logger().warning(msg)


def _post_json(*, endpoint: str, api_key: str, body: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise GptError(f"GPT API HTTPError: {e.code} {e.reason} {detail}") from e
    except Exception as e:
        raise GptError(f"GPT API 호출 실패: {e}") from e

    try:
        payload = json.loads(raw)
    except Exception as e:
        raise GptError(f"GPT 응답 JSON 파싱 실패: {e}") from e
    if isinstance(payload.get("error"), dict):
        msg = payload["error"].get("message")
        if isinstance(msg, str) and msg.strip():
            raise GptError(f"GPT API error payload: {msg.strip()}")
    return payload


def _remove_keys(body: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    out = dict(body)
    for k in keys:
        out.pop(k, None)
    return out


def _supports_temperature(model: str) -> bool:
    # gpt-5 계열(특히 nano)은 temperature를 지원하지 않는 경우가 있어 기본적으로 제외한다.
    return not model.startswith("gpt-5")


def _wants_low_reasoning(model: str) -> bool:
    # gpt-5 계열은 기본 reasoning이 커서 출력이 비는 문제가 발생할 수 있어 최소화한다.
    return model.startswith("gpt-5")


def call_gpt_text(
    *,
    model: str,
    system: str,
    user: str,
    max_output_tokens: int = 600,
    temperature: float | None = None,
    base_url: str | None = None,
) -> GptResponse:
    api_key = _get_api_key()
    url = (base_url or os.getenv("OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL).rstrip("/")
    responses_endpoint = f"{url}/responses"
    completions_endpoint = f"{url}/chat/completions"

    # 1) Responses API 먼저 시도
    try:
        body: dict[str, Any] = {
            "model": model,
            "input": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_output_tokens": max_output_tokens,
        }
        if temperature is not None and _supports_temperature(model):
            body["temperature"] = temperature
        if _wants_low_reasoning(model):
            body["reasoning"] = {"effort": "minimal"}

        try:
            _debug_log(f"[GPT] POST /responses model={model}")
            payload = _post_json(endpoint=responses_endpoint, api_key=api_key, body=body)
        except GptError as e:
            # 모델이 특정 파라미터를 거부하는 경우 한 번 더 제거 후 재시도
            if "Unsupported parameter: 'temperature'" in str(e) and "temperature" in body:
                payload = _post_json(endpoint=responses_endpoint, api_key=api_key, body=_remove_keys(body, ["temperature"]))
            elif "Unsupported parameter: 'reasoning'" in str(e) and "reasoning" in body:
                payload = _post_json(endpoint=responses_endpoint, api_key=api_key, body=_remove_keys(body, ["reasoning"]))
            else:
                raise
        text = _extract_output_text(payload)
        if text.strip():
            return GptResponse(raw=payload, output_text=text)

        # 응답은 왔지만 텍스트 추출이 안 되는 경우가 있어, input_text 포맷으로 한 번 더 시도한다.
        _logger().warning(f"[GPT] empty output from /responses payload={_safe_json_preview(payload)}")
        _logger().warning(f"[GPT] retry /responses with input_text content blocks model={model}")

        body2: dict[str, Any] = {
            "model": model,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system}]},
                {"role": "user", "content": [{"type": "input_text", "text": user}]},
            ],
            "max_output_tokens": max_output_tokens,
        }
        if temperature is not None and _supports_temperature(model):
            body2["temperature"] = temperature
        if _wants_low_reasoning(model):
            body2["reasoning"] = {"effort": "minimal"}
        payload2 = _post_json(endpoint=responses_endpoint, api_key=api_key, body=body2)
        text2 = _extract_output_text(payload2)
        if not text2.strip():
            _logger().warning(f"[GPT] empty output from /responses (retry) payload={_safe_json_preview(payload2)}")
            raise GptError("GPT 응답이 비어 있습니다.")
        return GptResponse(raw=payload2, output_text=text2)
    except GptError as e:
        # 모델/엔드포인트 호환 이슈일 수 있어 Chat Completions도 시도
        _logger().warning(f"[GPT] /responses failed, retry /chat/completions: {str(e)[:240]}")

    # 2) Chat Completions (호환용 폴백)
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        # 최신 모델은 max_tokens 대신 max_completion_tokens를 요구하는 경우가 있다.
        "max_completion_tokens": max_output_tokens,
    }
    if temperature is not None and _supports_temperature(model):
        body["temperature"] = temperature
    if _wants_low_reasoning(model):
        # 일부 모델은 chat.completions에서 reasoning_effort를 지원한다.
        body["reasoning_effort"] = "minimal"

    try:
        _debug_log(f"[GPT] POST /chat/completions model={model}")
        payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=body)
    except GptError as e:
        if "Unsupported parameter: 'max_completion_tokens'" in str(e):
            body2 = dict(body)
            body2.pop("max_completion_tokens", None)
            body2["max_tokens"] = max_output_tokens
            payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=body2)
        elif "Unsupported parameter: 'temperature'" in str(e) and "temperature" in body:
            payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=_remove_keys(body, ["temperature"]))
        elif "Unsupported parameter: 'reasoning_effort'" in str(e) and "reasoning_effort" in body:
            payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=_remove_keys(body, ["reasoning_effort"]))
        else:
            raise
    text = _extract_output_text(payload)
    if not text.strip():
        _logger().warning(f"[GPT] empty output from /chat/completions payload={_safe_json_preview(payload)}")
        raise GptError("GPT 응답이 비어 있습니다.")
    return GptResponse(raw=payload, output_text=text)


def _parse_tool_calls(msg: dict[str, Any]) -> list[ToolCall]:
    calls: list[ToolCall] = []
    tool_calls = msg.get("tool_calls")
    if not isinstance(tool_calls, list):
        return calls
    for tc in tool_calls:
        if not isinstance(tc, dict):
            continue
        if tc.get("type") != "function":
            continue
        fn = tc.get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        args_raw = fn.get("arguments")
        args: dict[str, Any] = {}
        if isinstance(args_raw, str):
            try:
                parsed = json.loads(args_raw)
                if isinstance(parsed, dict):
                    args = parsed
            except Exception:
                args = {}
        elif isinstance(args_raw, dict):
            args = args_raw
        calls.append(ToolCall(id=str(tc.get("id") or ""), name=str(name), arguments=args))
    return calls


def call_gpt_with_tools(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str,
    max_output_tokens: int = 600,
    temperature: float | None = None,
    base_url: str | None = None,
) -> GptToolResponse:
    api_key = _get_api_key()
    url = (base_url or os.getenv("OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL).rstrip("/")
    completions_endpoint = f"{url}/chat/completions"

    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "max_completion_tokens": max_output_tokens,
    }
    if temperature is not None and _supports_temperature(model):
        body["temperature"] = temperature
    if _wants_low_reasoning(model):
        body["reasoning_effort"] = "minimal"

    try:
        _debug_log(f"[GPT] POST /chat/completions (tools) model={model}")
        payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=body)
    except GptError as e:
        if "Unsupported parameter: 'max_completion_tokens'" in str(e):
            body2 = dict(body)
            body2.pop("max_completion_tokens", None)
            body2["max_tokens"] = max_output_tokens
            payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=body2)
        elif "Unsupported parameter: 'temperature'" in str(e) and "temperature" in body:
            payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=_remove_keys(body, ["temperature"]))
        elif "Unsupported parameter: 'reasoning_effort'" in str(e) and "reasoning_effort" in body:
            payload = _post_json(endpoint=completions_endpoint, api_key=api_key, body=_remove_keys(body, ["reasoning_effort"]))
        else:
            raise

    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise GptError("GPT 응답이 비어 있습니다.")
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        raise GptError("GPT 응답이 비어 있습니다.")
    content = msg.get("content") if isinstance(msg.get("content"), str) else ""
    tool_calls = _parse_tool_calls(msg)

    # tool_calls 없이 content도 비면 오류
    if not tool_calls and not content:
        raise GptError("GPT 응답이 비어 있습니다.")

    return GptToolResponse(raw=payload, message_text=content or "", tool_calls=tool_calls)


def _extract_first_json_object(text: str) -> str | None:
    # 모델이 JSON만 출력하도록 유도하지만, 실패할 수 있으므로 첫 JSON object만 복구한다.
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_json_from_model(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise GptError("GPT 응답이 비어 있습니다.")

    # 1) 그대로 JSON 파싱 시도
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # 2) 코드블록(```json ... ```) 제거
    fenced = re.search(r"```(?:json)?\\s*(\\{.*?\\})\\s*```", text, re.DOTALL)
    if fenced:
        try:
            obj = json.loads(fenced.group(1))
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass

    # 3) 텍스트에서 첫 JSON object 복구
    candidate = _extract_first_json_object(text)
    if candidate:
        obj = json.loads(candidate)
        if isinstance(obj, dict):
            return obj

    raise GptError("GPT JSON 응답 파싱에 실패했습니다.")
