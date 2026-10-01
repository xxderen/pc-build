"""Preisquellen. Jede Quelle liefert pro Teil das günstigste Angebot (oder None)."""
from __future__ import annotations

from dataclasses import dataclass, field

IN_STOCK = "in_stock"
SHORTLY = "shortly"
UNAVAILABLE = "unavailable"
UNKNOWN = "unknown"
LISTABLE = (IN_STOCK, SHORTLY, UNKNOWN)  # Angebote, die in Verlauf und Alarmen zählen


class ParseError(Exception):
    """Die Seite hat nicht die erwartete Struktur (Seitenlayout geändert?)."""


@dataclass
class Offer:
    price: float
    merchant: str | None
    url: str  # Link für Besucher (Vergleichsseite des Teils)
    availability: str
    source: str
    alts: tuple[str, ...] = field(default_factory=tuple)  # weitere Händler zum selben Preis

    @property
    def listable(self) -> bool:
        return self.availability in LISTABLE


def fetch_offer(source: str, client, spec, cfg) -> Offer | None:
    """Ruft die Quelle `source` für einen Teil ab. Raises Blocked / FetchError / ParseError."""
    from . import billiger, geizhals, shopify

    module = {"geizhals": geizhals, "billiger": billiger, "shopify": shopify}[source]
    return module.fetch(client, spec, cfg)
