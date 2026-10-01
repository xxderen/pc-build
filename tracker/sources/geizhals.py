"""Geizhals-Preisvergleich (Seiten von geizhals.de und preisvergleich.heise.de sind identisch aufgebaut).

geizhals.de blockt Python per Cloudflare-Challenge, preisvergleich.heise.de (gleiche Datenbasis, gleiche
Produkt-IDs) lieferte beim Test normale Seiten. Welcher Host genutzt wird, steht in config/config.json.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from . import IN_STOCK, SHORTLY, UNAVAILABLE, UNKNOWN, Offer, ParseError

PUBLIC_HOST = "https://geizhals.de"
_STATE = {"offer--available": IN_STOCK, "offer--shortly": SHORTLY, "offer--unavailable": UNAVAILABLE}
_PRICE = re.compile(r"([\d.]+),(\d{2})")
_FOREIGN = re.compile(r"Firmensitz in (.+?)\s+Infos")


def _price(text: str) -> float | None:
    m = _PRICE.search(text or "")
    return float(m.group(1).replace(".", "") + "." + m.group(2)) if m else None


def parse(html: str, public_url: str, only_german: bool = True, require_in_stock: bool = True) -> Offer | None:
    soup = BeautifulSoup(html, "html.parser")
    offerlist = soup.select_one("div.offerlist")
    if offerlist is None:
        raise ParseError("div.offerlist nicht gefunden")

    rows = []
    for row in offerlist.select(":scope > div.offer"):
        price_el = row.select_one(".gh_price")
        price = _price(price_el.get_text(" ", strip=True)) if price_el else None
        if price is None:
            continue
        cell = row.select_one(".offer__merchant")
        link = cell.select_one("a.merchant") if cell else None
        name = (link.get("data-merchant-name") if link else None) or (cell.get_text(" ", strip=True) if cell else None)
        hq = _FOREIGN.search(cell.get_text(" ", strip=True)) if cell else None
        if only_german and hq and hq.group(1).strip() != "Deutschland":
            continue  # Händler mit Firmensitz im Ausland
        state = next((_STATE[c] for c in row.get("class", []) if c in _STATE), UNKNOWN)
        rows.append((price, name, state))
    if not rows:
        return None  # "Es gibt derzeit keine Anbieter für dieses Produkt"

    pool = rows
    if require_in_stock:
        in_stock = [r for r in rows if r[2] in (IN_STOCK, SHORTLY)]
        pool = in_stock or rows
    best_price = min(r[0] for r in pool)
    tied = [r for r in pool if r[0] == best_price]
    return Offer(
        price=best_price,
        merchant=tied[0][1],
        url=public_url,
        availability=tied[0][2],
        source="geizhals",
        alts=tuple(dict.fromkeys(r[1] for r in tied[1:] if r[1] and r[1] != tied[0][1])),
    )


def fetch(client, spec: str, cfg: dict) -> Offer | None:
    gz = cfg["geizhals"]
    path = f"/{spec}.html?hloc=de"
    resp = client.get(gz["base_url"].rstrip("/") + path)
    return parse(resp.text, PUBLIC_HOST + path, gz.get("only_german_merchants", True), gz.get("require_in_stock", True))
