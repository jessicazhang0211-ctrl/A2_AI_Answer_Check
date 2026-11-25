"""One GPT call through the OpenAI chat-completions API, using only the standard library.

The key is read from the environment and never written to a file:
    OPENAI_API_KEY   your key (required for live mode)
    OPENAI_MODEL     model name, default gpt-4o-mini (use any chat model your account offers)
    OPENAI_BASE_URL  optional, default https://api.openai.com/v1
"""
import json, os, urllib.request

KEY = os.environ.get("OPENAI_API_KEY", "")
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
BASE = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")


def live():
    return bool(KEY)


def chat(system, user, json_mode=False, timeout=60):
    body = {"model": MODEL, "messages": [{"role": "system", "content": system},
                                         {"role": "user", "content": user}]}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.loads(r.read().decode("utf-8"))
    return payload["choices"][0]["message"]["content"]


def chat_json(system, user, timeout=60):
    """Return a dict, or None when the reply is not valid JSON (a caught error, not a crash)."""
    try:
        return json.loads(chat(system, user, json_mode=True, timeout=timeout))
    except (json.JSONDecodeError, TypeError):
        return None
