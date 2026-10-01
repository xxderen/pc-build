"""billiger.de als Fallback: Produktseiten enthalten schema.org-JSON-LD mit den 20 günstigsten Angeboten."""
from __future__ import annotations

import json

from bs4 import BeautifulSoup

from . import UNKNOWN, Offer, ParseError


def _iter_nodes(data):
    if isinstance(data, list):
        for item in data:
            yield from _iter_nodes(item)
    elif isinstance(data, dict):
        yield data
        yield from _iter_nodes(data.get("@graph", []))


def parse(html: str, page_url: str) -> Offer | None:
    soup = BeautifulSoup(html, "html.parser")
    scripts = soup.find_all("script", type="application/ld+json")
    if not scripts:
        raise ParseError("kein JSON-LD gefunden")
    for script in scripts:
        try:
            data = json.loads(script.string or "")
        except json.JSONDecodeError:
            continue
        for node in _iter_nodes(data):
            offers = node.get("offers") if node.get("@type") == "Product" else None
            if not isinstance(offers, dict):
                continue
            entries = [o for o in offers.get("offers", []) if isinstance(o.get("price"), (int, float))]
            if entries:
                best = min(o["price"] for o in entries)
                tied = [(o.get("seller") or {}).get("name") for o in entries if o["price"] == best]
                return Offer(float(best), tied[0], page_url, UNKNOWN, "billiger",
                             tuple(dict.fromkeys(m for m in tied[1:] if m and m != tied[0])))
            if isinstance(offers.get("lowPrice"), (int, float)):
                return Offer(float(offers["lowPrice"]), None, page_url, UNKNOWN, "billiger")
    raise ParseError("kein Product/AggregateOffer im JSON-LD")


def fetch(client, spec: str, cfg: dict) -> Offer | None:
    return parse(client.get(spec).text, spec)
