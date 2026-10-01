"""data/prices.json: aktueller Preis, Verlauf und zuletzt gemeldeter Preis je Teil.

Die Datei wird nur committet, wenn sich Preise wirklich ändern – deshalb enthält sie keine Zeitstempel
je Prüfung (die stehen in data/status.json, das nicht ins Repo kommt).
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = 1
ISO = "%Y-%m-%dT%H:%M:%SZ"


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def to_iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime(ISO)


def from_iso(text: str) -> datetime:
    return datetime.strptime(text, ISO).replace(tzinfo=timezone.utc)


def empty_prices() -> dict:
    return {"schema": SCHEMA, "updated_at": None, "parts": {}}


def load_prices(path: Path) -> dict:
    if not path.exists():
        return empty_prices()
    return json.loads(path.read_text(encoding="utf-8"))


def dump_prices(data: dict) -> str:
    """Stabile, diff-freundliche Ausgabe: ein Verlaufspunkt pro Zeile, Teile alphabetisch."""
    dumps = lambda value: json.dumps(value, ensure_ascii=False)  # noqa: E731
    lines = ["{", f'  "schema": {data["schema"]},', f'  "updated_at": {dumps(data["updated_at"])},', '  "parts": {']
    items = sorted(data["parts"].items())
    for index, (pid, part) in enumerate(items):
        history = part.get("history", [])
        lines += [f"    {dumps(pid)}: {{",
                  f'      "current": {dumps(part.get("current"))},',
                  f'      "notified": {dumps(part.get("notified"))},']
        if history:
            lines += ['      "history": [', ",\n".join("        " + dumps(point) for point in history), "      ]"]
        else:
            lines.append('      "history": []')
        lines.append("    }" + ("," if index < len(items) - 1 else ""))
    return "\n".join(lines + ["  }", "}"]) + "\n"


def prices_changed(old: dict, new: dict) -> bool:
    strip = lambda d: {k: v for k, v in d.items() if k != "updated_at"}  # noqa: E731
    return strip(old) != strip(new)


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ----------------------------------------------------------------------------- Verlauf
def last_point(history: list, source: str | None = None):
    for point in reversed(history):
        if source is None or point[2] == source:
            return point
    return None


def append_history(history: list, when: datetime, price: float, source: str, max_points: int = 500) -> bool:
    """Neuer Punkt nur bei Preis- oder Quellenwechsel (Verlauf besteht aus Änderungen)."""
    last = history[-1] if history else None
    if last and last[2] == source and abs(last[1] - price) < 0.005:
        return False
    history.append([to_iso(when), round(price, 2), source])
    del history[:-max_points]
    return True


def time_weighted_average(history: list, now: datetime, days: float, source: str | None = None):
    """Zeitgewichteter Durchschnitt (der Preis gilt bis zur nächsten Änderung) -> (Ø, abgedeckte Tage)."""
    points = [(from_iso(t), p) for t, p, s in history if source is None or s == source]
    if not points:
        return None, 0.0
    window_start = max(points[0][0], now - timedelta(days=days))
    span = (now - window_start).total_seconds()
    if span <= 0:
        return None, 0.0
    total = 0.0
    for index, (start, price) in enumerate(points):
        end = min(points[index + 1][0] if index + 1 < len(points) else now, now)
        begin = max(start, window_start)
        if end > begin:
            total += price * (end - begin).total_seconds()
    return total / span, span / 86400
