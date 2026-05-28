#!/usr/bin/env python3
"""
MXGA side-channel agent runner — OpenAI-compatible variant.

Same shape as run.py (Hermes/Grok), but talks to any OpenAI-compatible
`/chat/completions` endpoint and reasons only from data already captured
by the in-Worker LLM (no live X data access). Useful when:

  * The Grok / xsearch quota is exhausted.
  * You want a second-opinion from a different model family (Claude on
    OpenRouter, GPT-4o on the OpenAI proxy, etc.).
  * You don't have X developer API access (no xurl).

Trade-off vs run.py: no account_age / follower_count / live X status, so
N1/N2 follower gates degrade and L3/L4 history checks are weaker. Still
catches the obvious spam (display_name pattern, evidence_text promo).

Config: ~/.hermes-jobs/x-spam-agent/.env (chmod 600), additionally:
    AGENT_LLM_BASE_URL=https://api.openai.com/v1
    AGENT_LLM_API_KEY=sk-...
    AGENT_LLM_MODEL=gpt-4o-mini
    PROMPT_FILE_OPENAI=/Users/luolei/.hermes-jobs/x-spam-agent/prompt_openai.tmpl
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ENV_PATH = Path(
    os.environ.get("AGENT_ENV", os.path.expanduser("~/.hermes-jobs/x-spam-agent/.env"))
)


def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        sys.exit(f"missing config: {path}")
    out: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


ENV = load_env(ENV_PATH)
WORKER_URL = ENV.get("WORKER_URL", "https://x.zuoluo.tv").rstrip("/")
AGENT_TOKEN = ENV.get("AGENT_TOKEN") or sys.exit("AGENT_TOKEN missing in env")
AGENT_ID = ENV.get("AGENT_ID", "openai")

LLM_BASE = ENV.get("AGENT_LLM_BASE_URL") or sys.exit("AGENT_LLM_BASE_URL missing in env")
LLM_KEY = ENV.get("AGENT_LLM_API_KEY") or sys.exit("AGENT_LLM_API_KEY missing in env")
LLM_MODEL = ENV.get("AGENT_LLM_MODEL") or sys.exit("AGENT_LLM_MODEL missing in env")
LLM_TIMEOUT = int(ENV.get("AGENT_LLM_TIMEOUT_S", "60"))

PROMPT_FILE = Path(
    ENV.get(
        "PROMPT_FILE_OPENAI",
        os.path.expanduser("~/.hermes-jobs/x-spam-agent/prompt_openai.tmpl"),
    )
)
MAX_ITEMS = int(ENV.get("MAX_ITEMS_PER_CYCLE", "100"))
MAX_PARALLEL = int(ENV.get("MAX_PARALLEL", "15"))
DAILY_BUDGET = int(ENV.get("DAILY_BUDGET", "5000"))
LOG_DIR = Path(ENV.get("LOG_DIR", os.path.expanduser("~/.hermes-jobs/x-spam-agent/logs")))
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOCK_FILE = LOG_DIR / ".lock"

# ---- HTTP helpers ----------------------------------------------------------


def worker_call(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{WORKER_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {AGENT_TOKEN}")
    req.add_header("X-Agent-Id", AGENT_ID)
    req.add_header("User-Agent", f"mxga-agent-runner/{AGENT_ID}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode(errors="replace")[:500]}
    except Exception as e:
        return {"_error": str(e)[:200]}


def llm_chat(prompt: str) -> tuple[dict[str, Any] | None, str]:
    """OpenAI-compatible chat completion. Returns (parsed_json_or_None, raw)."""
    body = {
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        # Many proxies accept this; ones that don't will ignore it.
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        f"{LLM_BASE.rstrip('/')}/chat/completions",
        data=json.dumps(body).encode(),
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {LLM_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", f"mxga-agent-runner/{AGENT_ID}")
    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
            payload = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode(errors='replace')[:400]}"
    except Exception as e:
        return None, f"ERR: {e}"
    try:
        raw = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        return None, json.dumps(payload)[:400]
    # Strip optional markdown fences.
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", raw.strip(), flags=re.S)
    # Trailing-} guard (same as run.py).
    if cleaned.endswith("}}") and cleaned.count("{") < cleaned.count("}"):
        cleaned = cleaned[:-1]
    try:
        return json.loads(cleaned), raw
    except Exception:
        return None, raw


# ---- Decision routing (same policy as run.py) ------------------------------

POLICY_BL = float(ENV.get("BLACKLIST_CONF_MIN", "0.90"))
POLICY_WL = float(ENV.get("WHITELIST_CONF_MIN", "0.85"))


def route_decision(verdict: dict[str, Any]) -> str:
    label = verdict.get("label")
    conf = float(verdict.get("confidence") or 0.0)
    blocked = verdict.get("blocked_by")
    action = verdict.get("recommended_action") or verdict.get("action")
    if blocked:
        return "pending"
    if label in ("spam", "porn_bot") and conf >= POLICY_BL:
        return "blacklist"
    if label == "legit" and conf >= POLICY_WL:
        return "whitelist"
    if action == "approve_block" and conf >= POLICY_BL:
        return "blacklist"
    if action == "reject_legit" and conf >= POLICY_WL:
        return "whitelist"
    return "pending"


# ---- Per-item ---------------------------------------------------------------


def _esc(s: str) -> str:
    """Minimal escape for prompt interpolation — keep newlines but kill quotes
    that would break the rendered prompt's data block."""
    if not s:
        return ""
    return s.replace('"', "'").replace("\r", " ").replace("\n", " ")


def process_one(item: dict[str, Any]) -> dict[str, Any]:
    handle = item["handle"]
    uid = item.get("x_user_id")
    signals_hash = item.get("signals_hash")
    display_name = item.get("display_name") or ""
    evidence_text = item.get("evidence_text") or ""
    worker_verdict = item.get("verdict_label") or "?"
    worker_conf = item.get("confidence") or 0.0
    try:
        worker_reasons = json.loads(item.get("reasons") or "[]")
    except Exception:
        worker_reasons = []
    worker_reasons_str = " · ".join(str(r)[:80] for r in worker_reasons[:6])

    prompt = (
        PROMPT_FILE.read_text()
        .replace("HANDLE_PLACEHOLDER", _esc(handle))
        .replace("DISPLAY_NAME_PLACEHOLDER", _esc(display_name)[:120])
        .replace("EVIDENCE_PLACEHOLDER", _esc(evidence_text)[:240])
        .replace("WORKER_VERDICT_PLACEHOLDER", _esc(worker_verdict))
        .replace("WORKER_CONF_PLACEHOLDER", f"{worker_conf:.2f}")
        .replace("WORKER_REASONS_PLACEHOLDER", _esc(worker_reasons_str)[:400])
    )

    t0 = time.time()
    verdict, raw = llm_chat(prompt)
    elapsed = round(time.time() - t0, 1)

    if verdict is None:
        # Failure path — annotate with error so the row doesn't get retried
        # forever (Worker queue filter caps agent_attempts<3).
        body = {
            "handle": handle,
            "x_user_id": uid,
            "decision": "annotate",
            "label": "uncertain",
            "confidence": 0.0,
            "reasons": ["openai_runner_parse_failure"],
            "signals": [],
            "action": "needs_human",
            "model": LLM_MODEL,
            "signals_hash": signals_hash,
            "notes": raw[:1500],
        }
        resp = worker_call("POST", "/v1/agent/decide", body)
        return {
            "handle": handle,
            "elapsed_s": elapsed,
            "decision": "annotate",
            "label": "uncertain",
            "confidence": 0.0,
            "error": "parse_failure",
            "post_resp": resp,
        }

    decision = route_decision(verdict)
    body = {
        "handle": handle,
        "x_user_id": uid,
        "decision": decision,
        "label": verdict.get("label") or "uncertain",
        "confidence": float(verdict.get("confidence") or 0.0),
        "reasons": verdict.get("reasons") or [],
        "signals": verdict.get("fired_signals") or [],
        "evidence": verdict.get("evidence") or {},
        "action": verdict.get("recommended_action") or "needs_human",
        "model": LLM_MODEL,
        "signals_hash": signals_hash,
        "notes": (verdict.get("notes") or "")[:1500],
    }
    resp = worker_call("POST", "/v1/agent/decide", body)
    return {
        "handle": handle,
        "elapsed_s": elapsed,
        "decision": decision,
        "label": body["label"],
        "confidence": body["confidence"],
        "fired_signals": body["signals"],
        "blocked_by": verdict.get("blocked_by"),
        "post_resp": resp,
    }


# ---- Cycle ------------------------------------------------------------------


def acquire_lock() -> bool:
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
            os.kill(pid, 0)
            return False
        except (ProcessLookupError, ValueError):
            pass
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def release_lock() -> None:
    try:
        LOCK_FILE.unlink()
    except FileNotFoundError:
        pass


def daily_used() -> int:
    today = time.strftime("%Y-%m-%d", time.gmtime())
    log = LOG_DIR / f"{today}.jsonl"
    if not log.exists():
        return 0
    return sum(1 for _ in log.read_text().splitlines() if _.strip())


def append_log(rows: list[dict[str, Any]]) -> None:
    today = time.strftime("%Y-%m-%d", time.gmtime())
    log = LOG_DIR / f"{today}.jsonl"
    with log.open("a") as f:
        for r in rows:
            r["_ts"] = int(time.time())
            r["_runner"] = "openai"
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main() -> int:
    if not acquire_lock():
        print("another cycle already running, skip", file=sys.stderr)
        return 0
    try:
        used = daily_used()
        if used >= DAILY_BUDGET:
            print(f"daily budget hit: {used}/{DAILY_BUDGET}", file=sys.stderr)
            return 0
        want = min(MAX_ITEMS, DAILY_BUDGET - used)
        q = worker_call("GET", f"/v1/agent/queue?limit={want}")
        if "_error" in q or "_http_error" in q:
            print(f"queue fetch failed: {q}", file=sys.stderr)
            return 1
        items = q.get("queue") or []
        if not items:
            return 0
        rows: list[dict[str, Any]] = []
        with cf.ThreadPoolExecutor(max_workers=MAX_PARALLEL) as ex:
            for r in ex.map(process_one, items):
                rows.append(r)
        append_log(rows)
        counts = {"blacklist": 0, "whitelist": 0, "pending": 0, "annotate": 0}
        for r in rows:
            counts[r.get("decision") or "annotate"] = counts.get(r.get("decision") or "annotate", 0) + 1
        print(
            f"mxga agent (openai/{LLM_MODEL}): processed {len(rows)} items — "
            f"BL {counts['blacklist']} / WL {counts['whitelist']} / "
            f"pending {counts['pending']} / annotate {counts['annotate']}"
        )
        return 0
    finally:
        release_lock()


if __name__ == "__main__":
    sys.exit(main())
