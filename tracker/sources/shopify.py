"""Shopify-Shops (asiahorse.store): öffentliche Produkt-JSON (`<produkt>.js`), Preis in USD.

Die Preise werden mit dem EZB-Referenzkurs in Euro umgerechnet und mit der angegebenen MwSt. beaufschlagt –
das ist eine Schätzung des Endpreises, kein deutscher Händlerpreis.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

from . import IN_STOCK, UNAVAILABLE, Offer, ParseError

ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
_fx_cache: dict[str, float] = {}


def eur_per_unit(client, currency: str) -> float:
    """Euro pro 1 Einheit `currency` (EZB-Referenzkurs, pro Prozess einmal geholt)."""
    if currency == "EUR":
        return 1.0
    if currency not in _fx_cache:
        root = ET.fromstring(client.get(ECB_DAILY).text)
        rates = {c.get("currency"): float(c.get("rate")) for c in root.iter() if c.get("currency")}
        if currency not in rates:
            raise ParseError(f"EZB-Kurs für {currency} fehlt")
        _fx_cache[currency] = 1.0 / rates[currency]
    return _fx_cache[currency]


def parse(product: dict, sku: str, product_url: str, eur_rate: float, vat_pct: float, currency: str) -> Offer:
    variant = next((v for v in product.get("variants", []) if v.get("sku") == sku), None)
    if variant is None:
        raise ParseError(f"Variante {sku} nicht gefunden")
    net = variant["price"] / 100 * eur_rate
    price = round(net * (1 + vat_pct / 100), 2)
    note = f"asiahorse.store ({currency}→EUR" + (f", inkl. {vat_pct:g} % MwSt. geschätzt)" if vat_pct else ")")
    return Offer(price, note, f"{product_url}?variant={variant['id']}",
                 IN_STOCK if variant.get("available") else UNAVAILABLE, "shopify")


def fetch(client, spec: dict, cfg: dict) -> Offer | None:
    currency = spec.get("currency", "USD")
    product = client.get(spec["url"].rstrip("/") + ".js").json()
    return parse(product, spec["sku"], spec["url"], eur_per_unit(client, currency), spec.get("vat_pct", 0), currency)
