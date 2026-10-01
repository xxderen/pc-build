"""Höflicher HTTP-Client: ehrlicher User-Agent, zufällige Pausen, Blockaden werden erkannt
(und nie umgangen) – der Aufrufer fährt dann zurück."""
from __future__ import annotations

import email.utils
import logging
import random
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import requests

log = logging.getLogger("tracker.http")

# Statuscodes, die wir als "Zugriff verweigert / gedrosselt" behandeln.
BLOCK_STATUS = {403, 429, 503}
# Typische Texte von Bot-Challenge-Seiten (Cloudflare, Akamai, ...).
BLOCK_MARKERS = (
    "Just a moment",
    "Sichere Verbindung wird überprüft",
    "Enable JavaScript and cookies",
    "Attention Required",
    "Access Denied",
)


class Blocked(Exception):
    """Der Server blockt uns (403/429/503, Challenge-Seite). Nicht erneut versuchen."""

    def __init__(self, host: str, reason: str, retry_after_s: float | None = None):
        super().__init__(f"{host}: {reason}")
        self.host = host
        self.reason = reason
        self.retry_after_s = retry_after_s


class FetchError(Exception):
    """Netzwerkfehler oder unerwartete Antwort (kein Block)."""


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    if value.strip().isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


class PoliteClient:
    def __init__(self, user_agent: str, timeout: float = 20, delay: tuple[float, float] = (3.0, 8.0),
                 retries: int = 1, session: requests.Session | None = None, sleep=time.sleep):
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent, "Accept-Language": "de-DE,de;q=0.9"})
        self.timeout = timeout
        self.delay = delay
        self.retries = retries
        self._sleep = sleep
        self._last_request = 0.0

    def _pause(self) -> None:
        """Zufällige Pause seit dem letzten Request (nicht vor dem allerersten)."""
        if not self._last_request:
            return
        wait = random.uniform(*self.delay) - (time.monotonic() - self._last_request)
        if wait > 0:
            self._sleep(wait)

    def get(self, url: str, **kwargs) -> requests.Response:
        host = urlsplit(url).netloc
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            self._pause()
            self._last_request = time.monotonic()
            try:
                resp = self.session.get(url, timeout=self.timeout, **kwargs)
            except requests.RequestException as exc:
                last_error = exc
                log.warning("%s: Netzwerkfehler (%s), Versuch %d/%d", host, exc.__class__.__name__, attempt + 1, self.retries + 1)
                continue
            self._last_request = time.monotonic()

            challenged = resp.headers.get("cf-mitigated", "").lower() == "challenge"
            if resp.status_code in BLOCK_STATUS or challenged:
                reason = f"HTTP {resp.status_code}" + (" (Cloudflare-Challenge)" if challenged else "")
                raise Blocked(host, reason, _retry_after(resp.headers.get("Retry-After")))
            if resp.status_code >= 500:
                last_error = FetchError(f"HTTP {resp.status_code}")
                log.warning("%s: HTTP %d, Versuch %d/%d", host, resp.status_code, attempt + 1, self.retries + 1)
                continue
            if resp.status_code != 200:
                raise FetchError(f"{host}: HTTP {resp.status_code}")
            head = resp.text[:3000]
            if any(marker in head for marker in BLOCK_MARKERS):
                raise Blocked(host, "Challenge-Seite statt Inhalt")
            return resp
        raise FetchError(f"{host}: {last_error}")
