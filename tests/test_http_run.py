import json
import smtplib
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

from conftest import offer_page, offer_row
from tracker import notify, runtime, state
from tracker.http import Blocked, FetchError, PoliteClient
from tracker.run import run


# ------------------------------------------------------------------ HTTP-Client
class FakeResponse:
    def __init__(self, status=200, text="<html>ok</html>", headers=None):
        self.status_code, self.text, self.headers = status, text, headers or {}


class FakeSession:
    def __init__(self, *responses):
        self.responses, self.headers, self.calls = list(responses), {}, 0

    def get(self, url, timeout=None, **kw):
        self.calls += 1
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def client(*responses, retries=1, sleeps=None):
    sleeps = sleeps if sleeps is not None else []
    return PoliteClient("test-agent", delay=(2, 4), retries=retries, session=FakeSession(*responses), sleep=sleeps.append), sleeps


@pytest.mark.parametrize("response, reason", [
    (FakeResponse(403), "HTTP 403"),
    (FakeResponse(429, headers={"Retry-After": "120"}), "HTTP 429"),
    (FakeResponse(200, headers={"cf-mitigated": "challenge"}), "Cloudflare-Challenge"),
    (FakeResponse(200, "<title>Just a moment...</title>"), "Challenge-Seite"),
])
def test_blocks_are_detected_and_never_retried(response, reason):
    c, _ = client(response, FakeResponse())
    with pytest.raises(Blocked, match=reason):
        c.get("https://example.test/x")
    assert c.session.calls == 1


def test_retry_after_is_reported():
    c, _ = client(FakeResponse(429, headers={"Retry-After": "120"}))
    with pytest.raises(Blocked) as info:
        c.get("https://example.test/x")
    assert info.value.retry_after_s == 120


def test_server_error_is_retried_once_then_succeeds():
    c, _ = client(FakeResponse(500), FakeResponse(200, "fine"))
    assert c.get("https://example.test/x").text == "fine"


def test_network_errors_end_in_fetch_error():
    c, _ = client(requests.ConnectionError("down"), requests.ConnectionError("down"))
    with pytest.raises(FetchError):
        c.get("https://example.test/x")


def test_random_pause_between_requests():
    c, sleeps = client(FakeResponse(), FakeResponse())
    c.get("https://example.test/a")
    assert sleeps == []  # vor dem ersten Abruf keine Pause
    c.get("https://example.test/b")
    assert len(sleeps) == 1 and 0 < sleeps[0] <= 4


# ------------------------------------------------------------------ Backoff
def test_backoff_doubles_up_to_the_maximum_and_resets_on_success():
    rt = runtime.load(__import__("pathlib").Path("/nonexistent"))
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    backoff = {"base_minutes": 60, "max_minutes": 200}
    waits = []
    for _ in range(4):
        until = runtime.register_block(rt, "geizhals", now, "HTTP 403", backoff)
        waits.append((state.from_iso(until) - now) / timedelta(minutes=1))
    assert waits == [60, 120, 200, 200]
    assert runtime.is_blocked(rt, "geizhals", now + timedelta(minutes=199))
    assert not runtime.is_blocked(rt, "geizhals", now + timedelta(minutes=201))
    runtime.register_ok(rt, "geizhals")
    assert rt["sources"]["geizhals"]["fails"] == 0


def test_interval_gate_skips_runs_that_come_too_early():
    now = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    rt = {"last_run_at": state.to_iso(now - timedelta(minutes=10))}
    assert not runtime.due(rt, now, 30)
    assert runtime.due(rt, now, 10)
    assert runtime.due({"last_run_at": None}, now, 30)


# ------------------------------------------------------------------ kompletter Lauf gegen lokalen Server
class Shop:
    """Lokaler Preisvergleich-Ersatz: liefert pro Pfad (Status, Body); zählt Abrufe."""

    def __init__(self):
        self.pages, self.hits = {}, 0
        shop = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                shop.hits += 1
                status, body = shop.pages.get(self.path.split("?")[0], (404, ""))
                self.send_response(status)
                self.end_headers()
                self.wfile.write(body.encode())

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@pytest.fixture
def project(tmp_path):
    shop = Shop()
    root = tmp_path / "proj"
    (root / "config").mkdir(parents=True)
    (root / "data").mkdir()
    cfg = json.loads((__import__("conftest").ROOT / "config" / "config.json").read_text(encoding="utf-8"))
    cfg["geizhals"]["base_url"] = shop.url
    cfg["http"]["delay_s"] = [0, 0]
    cfg["sources"] = ["geizhals"]
    (root / "config" / "config.json").write_text(json.dumps(cfg), encoding="utf-8")
    (root / "config" / "targets.json").write_text(json.dumps({"targets": {"gpu": 80}}), encoding="utf-8")
    (root / "data" / "parts.json").write_text(json.dumps({"parts": {
        "gpu": {"id": "gpu", "name": "Test-GPU", "sources": {"geizhals": "test-gpu-a1"}},
        "ssd": {"id": "ssd", "name": "Test-SSD", "sources": {"geizhals": "test-ssd-a2"}},
    }}), encoding="utf-8")
    shop.pages["/test-gpu-a1.html"] = (200, offer_page(offer_row("100,00", "ShopA"), offer_row("120,00", "ShopB")))
    shop.pages["/test-ssd-a2.html"] = (200, offer_page())
    yield shop, root
    shop.server.shutdown()


class FakeSMTP:
    sent = []

    def __init__(self, host, port, context=None, timeout=None):
        self.host = host

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        assert (user, password) == ("me@example.test", "app-pass")

    def send_message(self, message):
        FakeSMTP.sent.append(message)


def test_full_run_commits_only_on_changes_and_mails_once(project, monkeypatch):
    shop, root = project
    monkeypatch.setenv("SMTP_USER", "me@example.test")
    monkeypatch.setenv("SMTP_PASSWORD", "app-pass")
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    FakeSMTP.sent.clear()
    prices = root / "data" / "prices.json"

    first = run(root, force=True)  # 1. Lauf: legt Verlauf an, kein Alarm (100 € > Ziel 80 €)
    assert (first.ok, first.prices_written, first.events) == (2, True, [])
    snapshot = prices.read_text(encoding="utf-8")
    data = json.loads(snapshot)
    assert data["parts"]["gpu"]["current"]["merchant"] == "ShopA" and data["parts"]["ssd"]["current"] is None

    second = run(root, force=True)  # unveränderte Preise: Datei bleibt byte-identisch (kein Commit nötig)
    assert not second.prices_written and prices.read_text(encoding="utf-8") == snapshot

    shop.pages["/test-gpu-a1.html"] = (200, offer_page(offer_row("85,00", "ShopC"), offer_row("100,00", "ShopA")))
    third = run(root, force=True)  # Preis sinkt 100 -> 85: Mail
    assert third.mail_sent and [e.kinds for e in third.events] == [["drop"]]
    mail = FakeSMTP.sent[0]
    assert "Test-GPU" in mail["Subject"] and "100,00 € → 85,00 €" in mail.get_body(("plain",)).get_content()
    assert json.loads(prices.read_text(encoding="utf-8"))["parts"]["gpu"]["notified"]["price"] == 85.0

    fourth = run(root, force=True)  # gleicher Preis: keine zweite Mail
    assert not fourth.events and len(FakeSMTP.sent) == 1

    shop.pages["/test-gpu-a1.html"] = (200, offer_page(offer_row("78,00", "ShopC")))
    fifth = run(root, force=True)  # weiter gesunken und unter Ziel: erneute Mail mit beiden Gründen
    assert [e.kinds for e in fifth.events] == [["drop", "target"]] and len(FakeSMTP.sent) == 2


def test_blocked_source_is_skipped_with_backoff_and_data_stays(project):
    shop, root = project
    run(root, force=True)
    before = (root / "data" / "prices.json").read_text(encoding="utf-8")
    shop.pages["/test-gpu-a1.html"] = (403, "")
    result = run(root, force=True)
    assert "gpu" in result.failed and not result.prices_written
    assert (root / "data" / "prices.json").read_text(encoding="utf-8") == before
    hits = shop.hits
    again = run(root, force=True)  # Quelle pausiert: es wird gar nicht erst angefragt
    assert shop.hits == hits and "pausiert" in again.failed["gpu"][0]
    status = json.loads((root / "data" / "status.json").read_text(encoding="utf-8"))
    assert status["sources"]["geizhals"]["blocked_until"] and "403" in status["sources"]["geizhals"]["last_error"]


def test_mail_failure_is_not_remembered_so_it_is_retried(project, monkeypatch):
    shop, root = project
    monkeypatch.setenv("SMTP_USER", "me@example.test")
    monkeypatch.setenv("SMTP_PASSWORD", "app-pass")

    def boom(*a, **k):
        raise smtplib.SMTPException("kaputt")

    monkeypatch.setattr(notify, "send", boom)
    run(root, force=True)
    shop.pages["/test-gpu-a1.html"] = (200, offer_page(offer_row("70,00", "ShopC")))
    result = run(root, force=True)
    assert result.events and not result.mail_sent
    assert json.loads((root / "data" / "prices.json").read_text(encoding="utf-8"))["parts"]["gpu"]["notified"] is None


def test_dry_run_writes_nothing(project):
    _, root = project
    run(root, force=True, dry_run=True)
    assert not (root / "data" / "prices.json").exists() and not (root / ".state").exists()
