"""Wann wird gemeldet? Preissenkung, Zielpreis erreicht oder deutlich unter dem 30-Tage-Durchschnitt –
ohne Doppelmeldungen (der zuletzt gemeldete Preis wird mitgeführt)."""
from __future__ import annotations

from dataclasses import dataclass

from .state import last_point, time_weighted_average, to_iso

DROP, TARGET, DEAL = "drop", "target", "deal"


@dataclass
class Event:
    part_id: str
    name: str
    kinds: list[str]
    new_price: float
    old_price: float | None
    merchant: str | None
    url: str
    target: float | None = None
    avg: float | None = None


def min_change(price: float, cfg: dict) -> float:
    """Kleinste Änderung, die als echte Preisbewegung zählt (Cent-Rauschen wird ignoriert)."""
    return max(cfg["min_change_eur"], price * cfg["min_change_pct"] / 100)


def evaluate(history: list, notified: dict | None, price: float, source: str, target: float | None, cfg: dict, now):
    """-> (Ereignisarten, vorheriger Preis, 30-Tage-Ø, neuer 'notified'-Stand). `history` ohne den neuen Preis."""
    step = min_change(price, cfg)
    previous = last_point(history, source)  # Vergleich nur innerhalb derselben Quelle
    prev_price = previous[1] if previous else None
    avg, coverage = time_weighted_average(history, now, cfg["avg_days"], source)
    deal_limit = avg * (1 - cfg["deal_threshold_pct"] / 100) if avg and coverage >= cfg["min_history_days"] else None

    kinds = []
    if prev_price is not None and price <= prev_price - step:
        kinds.append(DROP)
    if target is not None and price <= target and (prev_price is None or prev_price > target):
        kinds.append(TARGET)
    if deal_limit is not None and price <= deal_limit and (prev_price is None or prev_price > deal_limit or DROP in kinds):
        kinds.append(DEAL)

    if kinds and notified and price > notified["price"] - step:
        kinds = []  # gleicher oder schlechterer Preis als beim letzten Alarm
    if kinds:
        return kinds, prev_price, avg, {"price": price, "at": to_iso(now), "kinds": kinds}
    if notified and price > notified["price"] * (1 + cfg["rearm_rise_pct"] / 100):
        notified = None  # Preis ist deutlich gestiegen: die nächste Senkung wird wieder gemeldet
    return [], prev_price, avg, notified
