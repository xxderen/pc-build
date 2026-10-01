from datetime import datetime, timedelta, timezone

from tracker import events, state

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
CFG = {"deal_threshold_pct": 5, "avg_days": 30, "min_history_days": 3, "min_change_eur": 1.0, "min_change_pct": 0.5, "rearm_rise_pct": 5}


def hist(*points, source="geizhals"):
    """points: (Tage vor NOW, Preis)"""
    return [[state.to_iso(NOW - timedelta(days=d)), p, source] for d, p in points]


# ------------------------------------------------------------------ Verlauf & Durchschnitt
def test_history_records_changes_only():
    h = []
    assert state.append_history(h, NOW, 100.0, "geizhals")
    assert not state.append_history(h, NOW + timedelta(minutes=30), 100.0, "geizhals")
    assert state.append_history(h, NOW + timedelta(hours=1), 95.5, "geizhals")
    assert state.append_history(h, NOW + timedelta(hours=2), 95.5, "billiger")  # Quellenwechsel wird festgehalten
    assert len(h) == 3


def test_time_weighted_average_weights_by_duration():
    # 10 Tage 100 €, danach 5 Tage 80 € -> Ø 93,33 € über 15 Tage
    h = hist((15, 100.0), (5, 80.0))
    avg, coverage = state.time_weighted_average(h, NOW, 30)
    assert round(avg, 2) == 93.33 and round(coverage, 1) == 15.0


def test_average_ignores_other_sources():
    h = hist((10, 100.0)) + hist((5, 50.0), source="billiger")
    avg, _ = state.time_weighted_average(h, NOW, 30, "geizhals")
    assert avg == 100.0


def test_prices_changed_ignores_timestamp_only():
    a = {"schema": 1, "updated_at": "x", "parts": {"p": {"current": None, "notified": None, "history": []}}}
    b = {**a, "updated_at": "y"}
    assert not state.prices_changed(a, b)
    b["parts"] = {"p": {"current": {"price": 1}, "notified": None, "history": []}}
    assert state.prices_changed(a, b)


def test_dump_is_stable_and_loadable(tmp_path):
    data = {"schema": 1, "updated_at": "t", "parts": {"b": {"current": None, "notified": None, "history": []},
                                                      "a": {"current": {"price": 1.5}, "notified": None, "history": hist((1, 1.5))}}}
    text = state.dump_prices(data)
    assert text.index('"a"') < text.index('"b"')
    path = tmp_path / "p.json"
    state.write_atomic(path, text)
    assert state.load_prices(path)["parts"]["a"]["history"] == data["parts"]["a"]["history"]


# ------------------------------------------------------------------ Ereignisse
def test_first_sighting_below_target_alerts_but_without_history_no_drop_or_deal():
    kinds, prev, avg, notified = events.evaluate([], None, 90.0, "geizhals", 100.0, CFG, NOW)
    assert kinds == [events.TARGET] and prev is None and notified["price"] == 90.0


def test_drop_below_last_price_alerts_once():
    h = hist((2, 100.0))  # unter 3 Tagen Verlauf: noch kein Deal-Vergleich
    kinds, prev, _, notified = events.evaluate(h, None, 92.0, "geizhals", None, CFG, NOW)
    assert kinds == [events.DROP] and prev == 100.0
    # gleicher Preis beim nächsten Lauf: keine Wiederholung
    h2 = h + [[state.to_iso(NOW), 92.0, "geizhals"]]
    kinds, *_ = events.evaluate(h2, notified, 92.0, "geizhals", None, CFG, NOW + timedelta(minutes=30))
    assert kinds == []


def test_cent_noise_is_not_a_drop():
    kinds, *_ = events.evaluate(hist((2, 100.0)), None, 99.5, "geizhals", None, CFG, NOW)  # nur 0,50 € / 0,5 %
    assert kinds == []


def test_further_drop_after_alert_alerts_again():
    notified = {"price": 92.0, "at": "x", "kinds": ["drop"]}
    kinds, *_ = events.evaluate(hist((2, 100.0), (1, 92.0)), notified, 85.0, "geizhals", None, CFG, NOW)
    assert kinds == [events.DROP]


def test_target_fires_when_crossing_not_while_staying_below():
    h = hist((2, 120.0))
    assert events.evaluate(h, None, 99.0, "geizhals", 100.0, CFG, NOW)[0] == [events.DROP, events.TARGET]
    assert events.evaluate(hist((2, 98.0)), None, 98.0, "geizhals", 100.0, CFG, NOW)[0] == []


def test_deal_needs_enough_history_and_five_percent_below_average():
    h = hist((20, 100.0))  # 20 Tage lang 100 €
    kinds, _, avg, _ = events.evaluate(h, None, 94.0, "geizhals", None, CFG, NOW)
    assert round(avg) == 100 and events.DEAL in kinds and events.DROP in kinds
    assert events.evaluate(h, None, 96.0, "geizhals", None, CFG, NOW)[0] == [events.DROP]  # nur 4 % unter Ø
    young = hist((1, 100.0))  # erst 1 Tag Verlauf -> kein Deal
    assert events.DEAL not in events.evaluate(young, None, 90.0, "geizhals", None, CFG, NOW)[0]


def test_price_comparison_stays_within_one_source():
    h = hist((5, 100.0), source="geizhals")
    assert events.evaluate(h, None, 80.0, "billiger", None, CFG, NOW)[0] == []  # andere Quelle: kein "Drop"


def test_rearm_after_price_rises_again():
    notified = {"price": 90.0, "at": "x", "kinds": ["drop"]}
    kinds, _, _, still = events.evaluate(hist((3, 90.0)), notified, 93.0, "geizhals", None, CFG, NOW)
    assert kinds == [] and still == notified  # +3,3 %: noch nicht "zurückgesetzt"
    kinds, _, _, still = events.evaluate(hist((3, 90.0)), notified, 100.0, "geizhals", None, CFG, NOW)
    assert kinds == [] and still is None  # +11 %: nächste Senkung wird wieder gemeldet
