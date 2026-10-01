import json

import pytest

from conftest import fixture, offer_page as page, offer_row as row
from tracker.sources import IN_STOCK, SHORTLY, UNAVAILABLE, ParseError, billiger, geizhals, shopify

URL = "https://geizhals.de/x-a1.html?hloc=de"


def test_cheapest_in_stock_german_offer_is_chosen():
    # echte Seite (gekürzt): MobPicker ist am günstigsten, aber nicht lieferbar und hat Firmensitz in Polen
    offer = geizhals.parse(fixture("heise_9800x3d.html"), URL)
    assert (offer.price, offer.merchant, offer.availability) == (389.0, "Mindfactory", IN_STOCK)
    assert offer.url == URL and offer.source == "geizhals"


def test_foreign_and_unavailable_offers_can_be_allowed():
    html = fixture("heise_9800x3d.html")
    cheapest = geizhals.parse(html, URL, only_german=False, require_in_stock=False)
    assert (cheapest.price, cheapest.merchant, cheapest.availability) == (384.44, "MobPicker", UNAVAILABLE)
    in_stock = geizhals.parse(html, URL, only_german=False, require_in_stock=True)
    assert in_stock.merchant == "Mindfactory"  # lieferbar schlägt billiger-aber-nicht-lieferbar


def test_foreign_headquarters_notice_is_filtered():
    offer = geizhals.parse(fixture("geizhals_sn7100_foreign_notice.html"), URL)
    assert offer.merchant == "Coolblue" and offer.price == 271.9  # MobPicker (PL) 258,35 € wird übergangen


def test_unavailable_only_is_still_reported_as_unavailable():
    offer = geizhals.parse(page(row("1.499,90", "ShopA", "offer--unavailable")), URL)
    assert offer.availability == UNAVAILABLE and offer.price == 1499.90


def test_tied_merchants_become_alts_and_german_price_format_is_parsed():
    offer = geizhals.parse(page(row("1.219,00", "A", "offer--shortly"), row("1.219,00", "B"), row("1.300,00", "C")), URL)
    assert (offer.price, offer.merchant, offer.availability, offer.alts) == (1219.0, "A", SHORTLY, ("B",))


def test_no_offers_returns_none():
    assert geizhals.parse(fixture("geizhals_no_offers.html"), URL) is None


def test_changed_layout_raises():
    with pytest.raises(ParseError):
        geizhals.parse("<html><body>Wartungsarbeiten</body></html>", URL)


def test_billiger_json_ld():
    offer = billiger.parse(fixture("billiger_9800x3d.html"), "https://www.billiger.de/products/x")
    assert (offer.price, offer.merchant, offer.source) == (384.9, "amazon.de", "billiger")
    assert "LT-Ecom" in offer.alts and offer.availability == "unknown"


def test_billiger_without_json_ld_raises():
    with pytest.raises(ParseError):
        billiger.parse("<html></html>", "u")


def test_shopify_converts_usd_to_eur_with_vat():
    product = json.loads(fixture("shopify_matrix_pro.json"))
    offer = shopify.parse(product, "MatrixPro-120-IM-White-R-DTC", "https://asiahorse.store/products/x", 0.88, 19, "USD")
    assert offer.price == round(18.99 * 0.88 * 1.19, 2)
    assert offer.availability == IN_STOCK and offer.url.endswith("?variant=54327644193081")
    with pytest.raises(ParseError):
        shopify.parse(product, "gibt-es-nicht", "u", 0.88, 19, "USD")
