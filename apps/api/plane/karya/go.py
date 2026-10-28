# Karya (CWI Studio) — additions to the Plane API. Kept in this package so upstream merges touch one include line.
# SPDX-License-Identifier: AGPL-3.0-only
"""Karya Go: turn a spoken or typed sentence into a work item draft.

Speech goes to a speech-to-text service once and is dropped; the transcript goes to a chat model that fills a JSON
schema. Both are optional: without speech-to-text the app offers typing only, without a model the sentence becomes the
title. Every id the model returns is checked against the project before it reaches the app.
"""

import json
import logging
import os
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests

logger = logging.getLogger("plane.karya.go")

STT_URL = os.environ.get("KARYA_GO_STT_URL", "https://api.sarvam.ai/speech-to-text")
STT_KEY = os.environ.get("KARYA_GO_STT_KEY", "")
STT_MODEL = os.environ.get("KARYA_GO_STT_MODEL", "saaras:v3")
STT_MODE = os.environ.get("KARYA_GO_STT_MODE", "codemix")
LLM_URL = os.environ.get("KARYA_GO_LLM_URL", "https://api.sarvam.ai/v1/chat/completions")
# One Sarvam key serves both; never hand the speech key to some other model vendor.
LLM_KEY = os.environ.get("KARYA_GO_LLM_KEY", "") or (
    STT_KEY if "sarvam.ai" in LLM_URL and "sarvam.ai" in STT_URL else ""
)
LLM_MODEL = os.environ.get("KARYA_GO_LLM_MODEL", "sarvam-105b-conversations")  # ~0.6 s; plain sarvam-105b reasons ~20 s
TIMEZONE = ZoneInfo(os.environ.get("KARYA_GO_TIMEZONE", "Asia/Kolkata"))

MAX_AUDIO_BYTES = 1024 * 1024  # 30 s is ~120 KB (Opus) to ~500 KB (iOS AAC); caps what one call can bill
MAX_TEXT_CHARS = 2000
PRIORITIES = ["urgent", "high", "medium", "low", "none"]


class GoError(Exception):
    """A failure the app can show as is."""


def voice_enabled():
    return bool(STT_KEY)


def llm_enabled():
    return bool(LLM_KEY and LLM_URL and LLM_MODEL)


def transcribe(upload):
    """Audio file (webm/opus from Android, mp4/aac from iOS) -> transcript text."""
    if not voice_enabled():
        raise GoError("Voice is not set up on this Karya yet. Type the ticket instead.")
    if upload.size > MAX_AUDIO_BYTES:
        raise GoError("That recording is too long. Keep it under 30 seconds.")
    content_type = (upload.content_type or "audio/webm").split(";")[0]
    data = {"model": STT_MODEL, "language_code": "unknown"}
    if STT_MODE:
        data["mode"] = STT_MODE
    try:
        response = requests.post(
            STT_URL,
            headers={"api-subscription-key": STT_KEY},
            files={"file": (upload.name or "speech", upload.read(), content_type)},
            data=data,
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.warning("karya go: speech-to-text unreachable: %s", exc)
        raise GoError("Couldn't reach the speech service. Try again, or type it.") from exc
    if response.status_code != 200:
        logger.warning("karya go: speech-to-text %s: %s", response.status_code, response.text[:500])
        raise GoError("Couldn't understand the recording. Try again, or type it.")
    transcript = (response.json().get("transcript") or "").strip()
    if not transcript:
        raise GoError("Didn't catch anything. Hold the phone closer and try again.")
    return transcript


def _today():
    return datetime.now(TIMEZONE).date()


def _schema(member_ids, module_ids):
    # Nullable fields as anyOf: strict providers refuse an enum that mixes strings with null.
    module = {"anyOf": [{"type": "string", "enum": module_ids}, {"type": "null"}]} if module_ids else {"type": "null"}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "description", "assignee_ids", "priority", "target_date", "module_id"],
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "assignee_ids": {"type": "array", "items": {"type": "string", "enum": member_ids or [""]}},
            "priority": {"type": "string", "enum": PRIORITIES},
            "target_date": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "module_id": module,
        },
    }


def _prompt(text, project, members, modules, speaker):
    today = _today()
    week = ", ".join(f"{(today + timedelta(days=i)):%A} = {(today + timedelta(days=i)).isoformat()}" for i in range(7))
    people = "\n".join(
        f"- id {m['id']}: {m['display_name']}" + (f" ({m['full_name']})" if m["full_name"] else "") for m in members
    )
    mods = "\n".join(f"- id {m['id']}: {m['name']}" for m in modules) or "(none)"
    return f"""You turn one short request, spoken or typed by a business person, into a work item for the project
"{project["name"]}". The words may be Hindi, English or a mix; write the work item in clear English.

Rules:
- title: imperative, specific, at most 10 words, no trailing full stop. Never start with "Assign" or a person's name.
- description: 1-3 short sentences with the details that were said (what is wrong, where, expected result). Do not
  invent steps or facts. Empty string if the title already says everything.
- assignee_ids: people who should do the work, only from the list below; match first names, nicknames and Hindi
  spellings. "me" / "mujhe" / "mera" means the speaker. Empty list if nobody was named.
- priority: urgent whenever the words urgent / asap / abhi / turant / emergency / "production down" appear (never
  downgrade them to high), high (important, jaldi, today),
  low (whenever, not urgent), medium when work is clearly expected soon, otherwise none.
- target_date: YYYY-MM-DD only if a deadline was said ("by Friday", "kal tak", "end of month"); otherwise null.
  Today is {today:%A} {today.isoformat()}. Next 7 days: {week}. "kal" means tomorrow when it is a deadline.
- module_id: the module the work belongs to if it was named or is obvious, only from the list below; otherwise null.

Speaker: {speaker}

People in this project:
{people or "(none)"}

Modules:
{mods}

Request:
\"\"\"{text}\"\"\"
"""


def _call_llm(prompt, schema):
    try:
        response = requests.post(
            LLM_URL,
            headers={"Authorization": f"Bearer {LLM_KEY}", "api-subscription-key": LLM_KEY},
            json={
                "model": LLM_MODEL,
                "temperature": 0.1,
                "max_tokens": 800,  # a draft is ~100 tokens; the cap bounds cost per call
                "reasoning_effort": "low",
                "messages": [
                    {"role": "system", "content": "You reply with JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "work_item", "strict": True, "schema": schema},
                },
            },
            timeout=40,
        )
    except requests.RequestException as exc:
        logger.warning("karya go: model unreachable: %s", exc)
        return None
    if response.status_code != 200:
        logger.warning("karya go: model %s: %s", response.status_code, response.text[:500])
        return None
    try:
        content = response.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError):
        return None
    match = re.search(r"\{.*\}", content, re.S)  # tolerate fences or a stray sentence around the JSON
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except ValueError:
        return None


def _fallback(text):
    first = re.split(r"(?<=[.!?।])\s+", text.strip(), maxsplit=1)[0]
    title = first if len(first) <= 120 else first[:117].rstrip() + "…"
    return {
        "title": title,
        "description": text.strip() if text.strip() != title else "",
        "assignee_ids": [],
        "priority": "none",
        "target_date": None,
        "module_id": None,
    }


def _clean(raw, text, member_ids, module_ids):
    """Keep only what fits the project. Anything else falls back to the tap pickers."""
    draft = _fallback(text)
    if not isinstance(raw, dict):
        return draft, False
    title = str(raw.get("title") or "").strip().rstrip(".")
    if title:
        draft["title"] = title[:255]
        draft["description"] = str(raw.get("description") or "").strip()[:4000]
    assignees = raw.get("assignee_ids")
    if isinstance(assignees, list):
        draft["assignee_ids"] = list(dict.fromkeys(str(a) for a in assignees if str(a) in member_ids))
    if raw.get("priority") in PRIORITIES:
        draft["priority"] = raw["priority"]
    target = raw.get("target_date")
    if isinstance(target, str):
        try:
            parsed = date.fromisoformat(target[:10])
            if _today() - timedelta(days=1) <= parsed <= _today() + timedelta(days=730):
                draft["target_date"] = parsed.isoformat()
        except ValueError:
            pass
    if raw.get("module_id") and str(raw["module_id"]) in module_ids:
        draft["module_id"] = str(raw["module_id"])
    return draft, True


def make_draft(text, project, members, modules, speaker):
    """-> (draft dict, understood: bool). understood=False means the app should ask the user to fill the chips."""
    text = text.strip()[:MAX_TEXT_CHARS]
    member_ids = [m["id"] for m in members]
    module_ids = [m["id"] for m in modules]
    if not llm_enabled():
        return _fallback(text), False
    raw = _call_llm(_prompt(text, project, members, modules, speaker), _schema(member_ids, module_ids))
    return _clean(raw, text, set(member_ids), set(module_ids))
