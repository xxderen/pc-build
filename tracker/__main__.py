"""Aufruf: python -m tracker [--dry-run] [--force] [--only teil1,teil2] [--no-mail] [--test-mail]"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from . import notify
from .config import load as load_config
from .events import Event
from .run import run, write_github_outputs


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows-Konsole: UTF-8 erzwingen
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="tracker", description="Preise prüfen und Alarme versenden")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent, help="Projektordner")
    parser.add_argument("--dry-run", action="store_true", help="nichts speichern, keine Mail")
    parser.add_argument("--force", action="store_true", help="Intervall-Prüfung ignorieren")
    parser.add_argument("--only", help="nur diese Teile-IDs (Komma-getrennt)")
    parser.add_argument("--no-mail", action="store_true", help="Alarme erkennen, aber nicht senden")
    parser.add_argument("--test-mail", action="store_true", help="Test-Mail senden und beenden")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s",
                        datefmt="%H:%M:%S")

    if args.test_mail:
        cfg = load_config(args.root)["cfg"]["mail"]
        smtp = notify.smtp_from_env(cfg)
        if smtp is None:
            print("SMTP_USER und SMTP_PASSWORD (Gmail-App-Passwort) müssen als Umgebungsvariablen gesetzt sein.", file=sys.stderr)
            return 2
        sample = Event("test", "Testmail – Preisalarm funktioniert", ["drop", "target"], 99.0, 119.0, "Beispiel-Shop",
                       "https://geizhals.de", 100.0)
        notify.send(*notify.render([sample], cfg["subject_prefix"]), smtp)
        print(f"Testmail an {smtp.to} gesendet.")
        return 0

    only = {p.strip() for p in args.only.split(",")} if args.only else None
    result = run(args.root, dry_run=args.dry_run, force=args.force, only=only, send_mail=not args.no_mail)
    write_github_outputs(result)
    if result.skipped:
        return 0
    print(f"\n{result.ok}/{result.checked} Teile geprüft, {len(result.failed)} ohne Ergebnis, {len(result.events)} Alarm(e)"
          f"{', Mail gesendet' if result.mail_sent else ''}{', prices.json geändert' if result.prices_written else ''}")
    for pid, errors in result.failed.items():
        print(f"  ✗ {pid}: {'; '.join(errors)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
