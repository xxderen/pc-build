"""Ein Prüflauf: Preise holen, Verlauf pflegen, Alarme erkennen, Mails senden, Status schreiben."""
from __future__ import annotations

import copy
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from . import notify, runtime, state
from .config import load as load_config
from .events import Event, evaluate
from .http import Blocked, FetchError, PoliteClient
from .sources import Offer, ParseError, fetch_offer

log = logging.getLogger("tracker")


@dataclass
class Result:
    skipped: bool = False
    checked: int = 0
    ok: int = 0
    failed: dict = field(default_factory=dict)  # Teil -> Fehlertexte
    events: list = field(default_factory=list)
    mail_sent: bool = False
    prices_written: bool = False


def fetch_part(client, part: dict, cfg: dict, rt: dict, now):
    """Erste Quelle der Reihenfolge, die antwortet. -> (Offer | None, antwortende Quelle | None, Fehler)."""
    errors = []
    for name in cfg["sources"]:
        spec = part.get("sources", {}).get(name)
        if not spec:
            continue
        if runtime.is_blocked(rt, name, now):
            errors.append(f"{name}: pausiert bis {rt['sources'][name]['blocked_until']}")
            continue
        try:
            offer = fetch_offer(name, client, spec, cfg)
        except Blocked as exc:
            until = runtime.register_block(rt, name, now, exc.reason, cfg["backoff"], exc.retry_after_s)
            log.warning("Quelle %s blockiert uns (%s) – Pause bis %s", name, exc.reason, until)
            errors.append(f"{name}: {exc.reason}")
            continue
        except (FetchError, ParseError) as exc:
            log.warning("%s: Quelle %s fehlgeschlagen: %s", part["id"], name, exc)
            errors.append(f"{name}: {exc}")
            continue
        runtime.register_ok(rt, name)
        return offer, name, errors
    return None, None, errors


def merged_current(prev: dict | None, offer: Offer, now) -> dict:
    """Unverändert lassen, solange nichts Echtes passiert (kein Commit-Rauschen durch wechselnde Händler-Reihenfolge)."""
    if (prev and prev["price"] == offer.price and prev["availability"] == offer.availability and prev["source"] == offer.source
            and (prev["merchant"] == offer.merchant or prev["merchant"] in offer.alts)):
        return prev
    return {"price": offer.price, "merchant": offer.merchant, "url": offer.url, "source": offer.source,
            "availability": offer.availability, "since": state.to_iso(now)}


def apply_offer(entry: dict, part: dict, offer: Offer, target: float | None, cfg: dict, now):
    """Aktualisiert Eintrag und Verlauf. -> (Event | None, neuer notified-Stand bei Alarm)."""
    event, pending = None, None
    if offer.listable:
        kinds, prev_price, avg, notified = evaluate(entry["history"], entry["notified"], offer.price, offer.source,
                                                    target, cfg["alerts"], now)
        if kinds:
            event = Event(part["id"], part["name"], kinds, offer.price, prev_price, offer.merchant, offer.url, target, avg)
            pending = notified  # erst nach erfolgreichem Mailversand speichern
        else:
            entry["notified"] = notified
        state.append_history(entry["history"], now, offer.price, offer.source, cfg["history"]["max_points"])
    entry["current"] = merged_current(entry["current"], offer, now)
    return event, pending


def build_status(rt: dict, cfg: dict, parts: dict) -> dict:
    return {
        "generated_at": rt["last_run_at"],
        "interval_minutes": cfg["check_interval_minutes"],
        "summary": rt.get("last_summary", {}),
        "sources": {name: rt["sources"].get(name, {}) for name in cfg["sources"]},
        "parts": {pid: rt["parts"][pid] for pid in parts if pid in rt["parts"]},
    }


def run(root: Path, *, dry_run: bool = False, force: bool = False, only: set[str] | None = None, send_mail: bool = True) -> Result:
    conf = load_config(root)
    cfg, parts, targets = conf["cfg"], conf["parts"], conf["targets"]
    paths = {k: root / v for k, v in cfg["paths"].items()}
    now = state.now_utc()
    rt = runtime.load(paths["runtime"])
    result = Result()

    if not (force or only) and not runtime.due(rt, now, cfg["check_interval_minutes"]):
        log.info("Letzter Lauf liegt weniger als %.0f%% des Intervalls zurück – übersprungen.", 80)
        result.skipped = True
        _write_status(paths, rt, cfg, parts, dry_run)
        return result

    stored = state.load_prices(paths["prices"])
    data = copy.deepcopy(stored)
    http = cfg["http"]
    client = PoliteClient(http["user_agent"], http["timeout_s"], tuple(http["delay_s"]), http["retries"])

    pendings: dict[str, dict] = {}
    for pid, part in parts.items():
        if not part.get("sources") or (only and pid not in only):
            continue
        result.checked += 1
        offer, answered, errors = fetch_part(client, part, cfg, rt, now)
        if answered is None:
            result.failed[pid] = errors
            continue
        result.ok += 1
        rt["parts"][pid] = {"checked_at": state.to_iso(now), "source": answered}
        entry = data["parts"].setdefault(pid, {"current": None, "notified": None, "history": []})
        if offer is None:
            entry["current"] = None
            log.info("%s: keine Angebote (%s)", pid, answered)
            continue
        event, pending = apply_offer(entry, part, offer, targets.get(pid), cfg, now)
        log.info("%s: %.2f € (%s, %s)%s", pid, offer.price, offer.merchant, offer.availability,
                 f"  -> ALARM {event.kinds}" if event else "")
        if event:
            result.events.append(event)
            pendings[pid] = pending

    if result.events and send_mail and not dry_run and cfg["mail"]["enabled"]:
        smtp = notify.smtp_from_env(cfg["mail"])
        if smtp is None:
            log.warning("%d Alarm(e) erkannt, aber SMTP_USER/SMTP_PASSWORD fehlen – keine Mail gesendet.", len(result.events))
        else:
            subject, text, body = notify.render(result.events, cfg["mail"]["subject_prefix"])
            try:
                notify.send(subject, text, body, smtp)
                result.mail_sent = True
                for pid, notified in pendings.items():
                    data["parts"][pid]["notified"] = notified
                log.info("Mail gesendet: %s", subject)
            except Exception as exc:  # noqa: BLE001 – Fehler loggen, beim nächsten Lauf erneut versuchen
                log.error("Mailversand fehlgeschlagen (%s) – wird beim nächsten Lauf erneut gemeldet.", exc)

    rt["last_run_at"] = state.to_iso(now)
    rt["last_summary"] = {"checked": result.checked, "ok": result.ok, "failed": len(result.failed),
                          "alerts": len(result.events), "mail_sent": result.mail_sent}
    if not dry_run:
        if state.prices_changed(stored, data):
            data["updated_at"] = state.to_iso(now)
            state.write_atomic(paths["prices"], state.dump_prices(data))
            result.prices_written = True
        runtime.save(paths["runtime"], rt)
        _write_status(paths, rt, cfg, parts, dry_run)
    return result


def _write_status(paths: dict, rt: dict, cfg: dict, parts: dict, dry_run: bool) -> None:
    if not dry_run and rt["last_run_at"]:
        state.write_atomic(paths["status"], json.dumps(build_status(rt, cfg, parts), ensure_ascii=False, indent=1) + "\n")


def write_github_outputs(result: Result) -> None:
    """Für den Workflow: Deployen nur, wenn wirklich geprüft wurde."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as handle:
            handle.write(f"skipped={'true' if result.skipped else 'false'}\nchanged={'true' if result.prices_written else 'false'}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary and not result.skipped:
        lines = [f"### Preisprüfung: {result.ok}/{result.checked} Teile ok, {len(result.events)} Alarm(e), "
                 f"Mail {'gesendet' if result.mail_sent else 'nicht gesendet'}"]
        lines += [f"- ⚠️ `{pid}`: {'; '.join(errs)}" for pid, errs in result.failed.items()]
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
