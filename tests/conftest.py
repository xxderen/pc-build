import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def offer_row(price, merchant, state="offer--available", notice=""):
    return (f'<div class="offer {state}"><div class="offer__price"><span class="gh_price">€ {price}</span></div>'
            f'<div class="offer__merchant"><a class="merchant" data-merchant-name="{merchant}">{merchant}</a> {notice} Infos AGB</div></div>')


def offer_page(*rows):
    return f'<html><body><div class="offerlist"><div class="offerlist-header"></div>{"".join(rows)}</div></body></html>'
