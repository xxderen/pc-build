"""Laufzeit-Zustand zwischen zwei Läufen (Backoff, letzter Lauf). Wird NICHT committet:
lokal liegt er in .state/runtime.json, in GitHub Actions wird der Ordner per Cache weitergereicht."""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from .state import from_iso, to_iso, write_atomic


def load(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    data.setdefault("last_run_at", None)
    data.setdefault("sources", {})
    data.setdefault("parts", {})
    return data


def save(path: Path, data: dict) -> None:
    write_atomic(path, json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def source_state(rt: dict, name: str) -> dict:
    return rt["sources"].setdefault(name, {"fails": 0, "blocked_until": None, "last_error": None})


def is_blocked(rt: dict, name: str, now) -> bool:
    until = source_state(rt, name)["blocked_until"]
    return bool(until) and from_iso(until) > now


def register_block(rt: dict, name: str, now, reason: str, backoff: dict, retry_after_s: float | None = None) -> str:
    """Backoff verdoppelt sich mit jeder weiteren Blockade (base, 2*base, ... bis max)."""
    state = source_state(rt, name)
    state["fails"] += 1
    minutes = min(backoff["base_minutes"] * 2 ** (state["fails"] - 1), backoff["max_minutes"])
    if retry_after_s:
        minutes = max(minutes, min(retry_after_s / 60, backoff["max_minutes"]))
    state["blocked_until"] = to_iso(now + timedelta(minutes=minutes))
    state["last_error"] = reason
    return state["blocked_until"]


def register_ok(rt: dict, name: str) -> None:
    state = source_state(rt, name)
    state.update(fails=0, blocked_until=None, last_error=None)


def due(rt: dict, now, interval_minutes: float) -> bool:
    """Läuft das Skript häufiger als das Intervall (z. B. manueller Start), wird übersprungen."""
    last = rt["last_run_at"]
    return not last or (now - from_iso(last)) >= timedelta(minutes=interval_minutes * 0.8)
