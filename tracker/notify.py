"""Preisalarm per E-Mail (Gmail-SMTP mit App-Passwort). Zugangsdaten nur aus Umgebungsvariablen/Secrets."""
from __future__ import annotations

import html
import os
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage

from .events import DEAL, DROP, TARGET, Event

LABELS = {DROP: "Preis gesunken", TARGET: "Zielpreis erreicht", DEAL: "Deal: deutlich unter dem 30-Tage-Ø"}


@dataclass
class Smtp:
    host: str
    port: int
    user: str
    password: str
    to: str
    sender: str


def smtp_from_env(cfg: dict, env=os.environ) -> Smtp | None:
    user, password = env.get("SMTP_USER"), env.get("SMTP_PASSWORD")
    if not (user and password):
        return None
    return Smtp(cfg.get("smtp_host", "smtp.gmail.com"), int(cfg.get("smtp_port", 465)), user, password,
                env.get("MAIL_TO") or user, env.get("MAIL_FROM") or user)


def eur(value: float) -> str:
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " €"


def pct(value: float) -> str:
    return f"{value:.1f}".replace(".", ",") + " %"


def _saving(event: Event) -> str:
    if event.old_price is None or event.old_price <= event.new_price:
        return "–"
    diff = event.old_price - event.new_price
    return f"{eur(diff)} ({pct(diff / event.old_price * 100)})"


def _lines(event: Event) -> list[tuple[str, str]]:
    rows = [("Alt → Neu", f"{eur(event.old_price)} → {eur(event.new_price)}" if event.old_price else f"neu: {eur(event.new_price)}"),
            ("Ersparnis", _saving(event))]
    if event.avg:
        rows.append(("30-Tage-Ø", f"{eur(event.avg)} (jetzt {pct((1 - event.new_price / event.avg) * 100)} darunter)"))
    if event.target:
        rows.append(("Zielpreis", eur(event.target)))
    rows.append(("Händler", event.merchant or "–"))
    rows.append(("Link", event.url))
    return rows


def render(events: list[Event], prefix: str = "[PC-Build]") -> tuple[str, str, str]:
    count = len(events)
    names = ", ".join(e.name for e in events[:2]) + (", …" if count > 2 else "")
    subject = f"{prefix} {count} Preisalarm{'e' if count > 1 else ''}: {names}"

    text, blocks = [], []
    for event in events:
        kinds = " · ".join(LABELS[k] for k in event.kinds)
        rows = _lines(event)
        text.append(f"{event.name}\n  {kinds}\n" + "\n".join(f"  {label}: {value}" for label, value in rows))
        cells = "".join(
            f'<tr><td style="padding:2px 12px 2px 0;color:#666">{html.escape(label)}</td><td style="padding:2px 0">'
            + (f'<a href="{html.escape(value)}">zum Angebot</a>' if label == "Link" else html.escape(value)) + "</td></tr>"
            for label, value in rows)
        blocks.append(f'<h3 style="margin:18px 0 2px">{html.escape(event.name)}</h3>'
                      f'<div style="color:#0a7d2c;font-weight:600">{html.escape(kinds)}</div><table>{cells}</table>')
    body = f'<div style="font-family:system-ui,Segoe UI,sans-serif;font-size:15px">{"".join(blocks)}' \
           f'<p style="color:#888;font-size:12px;margin-top:24px">Preise exkl. Versand, ohne Gewähr.</p></div>'
    return subject, "\n\n".join(text) + "\n\nPreise exkl. Versand, ohne Gewähr.\n", body


def send(subject: str, text: str, body_html: str, smtp: Smtp) -> None:
    message = EmailMessage()
    message["Subject"], message["From"], message["To"] = subject, smtp.sender, smtp.to
    message.set_content(text)
    message.add_alternative(body_html, subtype="html")
    if smtp.port == 465:
        with smtplib.SMTP_SSL(smtp.host, smtp.port, context=ssl.create_default_context(), timeout=30) as server:
            server.login(smtp.user, smtp.password)
            server.send_message(message)
    else:
        with smtplib.SMTP(smtp.host, smtp.port, timeout=30) as server:
            server.starttls(context=ssl.create_default_context())
            server.login(smtp.user, smtp.password)
            server.send_message(message)
