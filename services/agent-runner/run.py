#!/usr/bin/env python3
"""
Side-channel MXGA agent runner.

One cron tick = one cycle:
  1. GET /v1/agent/queue?limit=<N>     (Bearer AGENT_TOKEN)
  2. For each handle, invoke `hermes -z PROMPT --yolo` via timeout-bounded
     subprocess; parse JSON output.
  3. Route the verdict through policy.yaml thresholds → decision in
     {blacklist, whitelist, pending, annotate}.
  4. POST /v1/agent/decide  (Bearer AGENT_TOKEN, X-Agent-Id: <agent_id>)
  5. Append a JSONL log line per item.

Designed to be invoked by `hermes cron` or plain `cron` / `launchd`.
Idempotent: the Worker side filters out items already scored against the
current signals_hash, so re-running on the same queue is a no-op.

Config: ~/.hermes-jobs/x-spam-agent/.env (chmod 600) with
    WORKER_URL=https://x.zuoluo.tv
    AGENT_TOKEN=<wrangler secret>
    AGENT_ID=hermes
    HERMES_BIN=/Users/luolei/.local/bin/hermes
    PROMPT_FILE=/Users/luolei/.hermes-jobs/x-spam-agent/prompt.tmpl
    POLICY_FILE=/Users/luolei/.hermes-jobs/x-spam-agent/policy.yaml
    MAX_ITEMS_PER_CYCLE=20
    MAX_PARALLEL=8
    DAILY_BUDGET=300
    LOG_DIR=/Users/luolei/.hermes-jobs/x-spam-agent/logs
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ---- Config loading --------------------------------------------------------

ENV_PATH = Path(
    os.environ.get("AGENT_ENV", os.path.expanduser("~/.hermes-jobs/x-spam-agent/.env"))
)


def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        sys.exit(f"missing config: {path}")
    out: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


ENV = load_env(ENV_PATH)
WORKER_URL = ENV.get("WORKER_URL", "https://x.zuoluo.tv").rstrip("/")
AGENT_TOKEN = ENV.get("AGENT_TOKEN") or sys.exit("AGENT_TOKEN missing in env")
AGENT_ID = ENV.get("AGENT_ID", "hermes")
HERMES_BIN = ENV.get("HERMES_BIN", "/Users/luolei/.local/bin/hermes")
PROMPT_FILE = Path(
    ENV.get("PROMPT_FILE", os.path.expanduser("~/.hermes-jobs/x-spam-agent/prompt.tmpl"))
)
POLICY_FILE = Path(
    ENV.get("POLICY_FILE", os.path.expanduser("~/.hermes-jobs/x-spam-agent/policy.yaml"))
)
MAX_ITEMS = int(ENV.get("MAX_ITEMS_PER_CYCLE", "20"))
MAX_PARALLEL = int(ENV.get("MAX_PARALLEL", "8"))
DAILY_BUDGET = int(ENV.get("DAILY_BUDGET", "300"))
PER_ITEM_TIMEOUT_S = int(ENV.get("PER_ITEM_TIMEOUT_S", "180"))
LOG_DIR = Path(ENV.get("LOG_DIR", os.path.expanduser("~/.hermes-jobs/x-spam-agent/logs")))
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Single-instance lock so two cron ticks can't overlap.
LOCK_FILE = LOG_DIR / ".lock"

# Minimal YAML reader — policy.yaml is a flat key:value file by convention.
# Avoids a pip dependency.
def load_policy(path: Path) -> dict[str, float]:
    p = {
        "blacklist_conf_min": 0.90,
        "whitelist_conf_min": 0.85,
        "pending_when_unsure": True,
        "annotate_only_when_uid_missing": True,
    }
    if not path.exists():
        return p
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if v.lower() in ("true", "false"):
            p[k] = v.lower() == "true"
        else:
            try:
                p[k] = float(v)
            except ValueError:
                p[k] = v
    return p


POLICY = load_policy(POLICY_FILE)

# ---- HTTP helpers ----------------------------------------------------------


def http_json(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{WORKER_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {AGENT_TOKEN}")
    req.add_header("X-Agent-Id", AGENT_ID)
    # Cloudflare's default bot rules block the Python-urllib UA on a number of
    # zones (HTTP 1010). Identify ourselves explicitly.
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


# ---- Hermes invocation -----------------------------------------------------

JSON_TAIL_FIXUP = re.compile(r"\}\s*\}\s*$")


def run_hermes(handle: str) -> tuple[dict[str, Any] | None, str]:
    """Returns (parsed_json_or_None, raw_text)."""
    prompt = PROMPT_FILE.read_text().replace("HANDLE_PLACEHOLDER", handle)
    try:
        proc = subprocess.run(
            [HERMES_BIN, "-z", prompt, "--yolo"],
            capture_output=True,
            text=True,
            timeout=PER_ITEM_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return None, "TIMEOUT"
    raw = (proc.stdout or "").strip()
    # Strip optional markdown fences.
    raw = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", raw, flags=re.S)
    # Heuristic fixup for occasional trailing extra `}` (seen ~1/100 in tests).
    if raw.endswith("}}") and raw.count("{") < raw.count("}"):
        raw = raw[:-1]
    try:
        return json.loads(raw), raw
    except Exception:
        return None, raw


# ---- Decision routing ------------------------------------------------------


def route_decision(verdict: dict[str, Any]) -> str:
    """Returns one of: blacklist | whitelist | pending | annotate."""
    label = verdict.get("label")
    conf = float(verdict.get("confidence") or 0.0)
    blocked = verdict.get("blocked_by")
    action = verdict.get("action") or verdict.get("recommended_action")

    if blocked:
        # Hermes hit an A1/A2/A3 abort → it doesn't know enough.
        return "pending"
    if label in ("spam", "porn_bot") and conf >= POLICY["blacklist_conf_min"]:
        return "blacklist"
    if label == "legit" and conf >= POLICY["whitelist_conf_min"]:
        # Whitelisting via agent is more dangerous than blacklisting (a wrong
        # whitelist permanently lets spam through). Per current policy we
        # still route to the agent_whitelist staging bucket; the human still
        # has to manually promote to the real `whitelisted` status.
        return "whitelist"
    if action == "approve_block" and conf >= POLICY["blacklist_conf_min"]:
        return "blacklist"
    if action == "reject_legit" and conf >= POLICY["whitelist_conf_min"]:
        return "whitelist"
    return "pending"


# ---- Per-item processing ---------------------------------------------------


def process_one(item: dict[str, Any]) -> dict[str, Any]:
    """Run Hermes against one queue item, route, POST decision back. Returns log row."""
    handle = item["handle"]
    uid = item.get("x_user_id")
    signals_hash = item.get("signals_hash")
    t0 = time.time()
    verdict, raw = run_hermes(handle)
    elapsed = round(time.time() - t0, 1)
    if verdict is None:
        # Hermes failed/timed out — mark attempt and bail. The Worker queue
        # filter on agent_attempts<3 caps retries.
        body = {
            "handle": handle,
            "x_user_id": uid,
            "decision": "annotate",
            "label": "uncertain",
            "confidence": 0.0,
            "reasons": ["agent_failed_or_timeout"],
            "signals": [],
            "action": "needs_human",
            "model": "grok-4.3",
            "signals_hash": signals_hash,
            "notes": (raw[:1500] if raw else "no output"),
        }
        resp = http_json("POST", "/v1/agent/decide", body)
        return {
            "handle": handle,
            "elapsed_s": elapsed,
            "decision": "annotate",
            "label": "uncertain",
            "confidence": 0.0,
            "post_resp": resp,
            "error": "parse_or_timeout",
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
        "model": "grok-4.3",
        "signals_hash": signals_hash,
        "notes": (verdict.get("notes") or "")[:1500],
    }
    resp = http_json("POST", "/v1/agent/decide", body)
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


# ---- Cycle -----------------------------------------------------------------


def acquire_lock() -> bool:
    """Coarse single-instance lock based on PID-in-file."""
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
            os.kill(pid, 0)  # signal 0 = liveness probe
            return False  # still running
        except (ProcessLookupError, ValueError):
            pass  # stale lock — fall through and overwrite
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def release_lock() -> None:
    try:
        LOCK_FILE.unlink()
    except FileNotFoundError:
        pass


def daily_used() -> int:
    """How many items has this agent already processed today (UTC)?"""
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
        remaining_budget = DAILY_BUDGET - used
        want = min(MAX_ITEMS, remaining_budget)

        q = http_json("GET", f"/v1/agent/queue?limit={want}")
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

        # Stdout summary — when invoked under `hermes cron` with --deliver, this
        # becomes a short Lark/Telegram/Discord ping per cycle.
        decisions = {"blacklist": 0, "whitelist": 0, "pending": 0, "annotate": 0}
        for r in rows:
            d = r.get("decision") or "annotate"
            decisions[d] = decisions.get(d, 0) + 1
        print(
            f"mxga agent: processed {len(rows)} items — "
            f"BL {decisions['blacklist']} / WL {decisions['whitelist']} / "
            f"pending {decisions['pending']} / annotate {decisions['annotate']}"
        )
        return 0
    finally:
        release_lock()


if __name__ == "__main__":
    sys.exit(main())
