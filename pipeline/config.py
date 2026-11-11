"""Load and validate the universe (themes, indices) and the default watchlist."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path

import yaml

# 4–6 digit base code plus a Taiwan market suffix, e.g. 2330.TW, 00878.TW, 6488.TWO
_SYMBOL_RE = re.compile(r"^\d{4,6}[A-Z]?\.(TW|TWO)$")
_INDEX_RE = re.compile(r"^[A-Z]{2,6}$")
_THEME_RE = re.compile(r"^[a-z][a-z0-9_]{1,23}$")

DEFAULT_HISTORY_DAYS = 500
DEFAULT_BACKTEST_DAYS = 2500  # about ten years of trading days

WATCH = "watch"  # in the default tracking list
POOL = "pool"  # analysed, shown in the screener

STOCK = "stock"
ETF = "etf"
INDEX = "index"


@dataclass(frozen=True)
class Stock:
    code: str
    name: str
    role: str = WATCH
    kind: str = STOCK
    themes: tuple[str, ...] = ()
    yahoo: str | None = None  # Yahoo symbol when it differs from the code (indices)

    @property
    def market(self) -> str:
        if self.kind == INDEX:
            return "INDEX"
        return "TPEx" if self.code.endswith(".TWO") else "TWSE"

    @property
    def symbol(self) -> str:
        return self.yahoo or self.code

    def with_other_suffix(self) -> "Stock | None":
        """The same stock on the other Taiwan board, for when the suffix was wrong."""
        if self.kind == INDEX:
            return None
        base, suffix = self.code.rsplit(".", 1)
        return replace(self, code=f"{base}.{'TWO' if suffix == 'TW' else 'TW'}")


@dataclass(frozen=True)
class Theme:
    key: str
    name: str
    kind: str = STOCK


@dataclass(frozen=True)
class Watchlist:
    stocks: tuple[Stock, ...]
    history_days: int
    backtest_days: int = DEFAULT_BACKTEST_DAYS
    themes: tuple[Theme, ...] = ()


def _check_symbol(path: Path, code: str) -> str:
    code = str(code).strip().upper()
    if not _SYMBOL_RE.match(code):
        raise ValueError(
            f"{path}: invalid symbol {code!r}; use a Taiwan suffix such as 2330.TW or 6488.TWO"
        )
    return code


def _parse_watch(path: Path, entries: list) -> list[Stock]:
    stocks: list[Stock] = []
    seen: set[str] = set()
    for entry in entries:
        code = _check_symbol(path, entry.get("code", ""))
        if code in seen:
            raise ValueError(f"{path}: duplicate symbol {code}")
        seen.add(code)
        stocks.append(Stock(code=code, name=str(entry.get("name", "")).strip() or code))
    return stocks


def _parse_universe(path: Path, raw: dict) -> tuple[list[Stock], list[Stock], list[Theme]]:
    indices: list[Stock] = []
    for entry in raw.get("indices") or []:
        code = str(entry.get("code", "")).strip().upper()
        if not _INDEX_RE.match(code):
            raise ValueError(f"{path}: invalid index code {code!r}")
        indices.append(
            Stock(
                code=code,
                name=str(entry.get("name", "")).strip() or code,
                role=POOL,
                kind=INDEX,
                yahoo=str(entry.get("yahoo", "")).strip() or None,
            )
        )

    themes: list[Theme] = []
    by_code: dict[str, Stock] = {}
    for block in raw.get("themes") or []:
        key = str(block.get("key", "")).strip()
        if not _THEME_RE.match(key):
            raise ValueError(f"{path}: invalid theme key {key!r}")
        if any(t.key == key for t in themes):
            raise ValueError(f"{path}: duplicate theme {key}")
        kind = ETF if block.get("kind") == ETF else STOCK
        themes.append(Theme(key=key, name=str(block.get("name", "")).strip() or key, kind=kind))
        for raw_code, name in (block.get("stocks") or {}).items():
            code = _check_symbol(path, raw_code)
            known = by_code.get(code)
            if known is None:
                by_code[code] = Stock(code=code, name=str(name).strip() or code, role=POOL, kind=kind, themes=(key,))
            elif key not in known.themes:
                by_code[code] = replace(known, themes=(*known.themes, key))

    # Older flat format: a plain list under `stocks`.
    for stock in _parse_watch(path, raw.get("stocks") or []):
        by_code.setdefault(stock.code, replace(stock, role=POOL))

    return indices, list(by_code.values()), themes


def load_watchlist(path: Path, universe_path: Path | None = None) -> Watchlist:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries = raw.get("stocks") or []
    if not entries:
        raise ValueError(f"{path}: 'stocks' must list at least one symbol")
    watch = _parse_watch(path, entries)

    indices: list[Stock] = []
    pool: list[Stock] = []
    themes: list[Theme] = []
    if universe_path is not None and universe_path.exists():
        pool_raw = yaml.safe_load(universe_path.read_text(encoding="utf-8")) or {}
        indices, pool, themes = _parse_universe(universe_path, pool_raw)

    pool_by_code = {s.code: s for s in pool}
    stocks: list[Stock] = list(indices)
    for w in watch:
        known = pool_by_code.pop(w.code, None)
        stocks.append(replace(known, role=WATCH, name=w.name) if known else w)
    stocks += pool_by_code.values()

    history_days = int(raw.get("history_days", DEFAULT_HISTORY_DAYS))
    if not 60 <= history_days <= 2500:
        raise ValueError(f"{path}: history_days must be between 60 and 2500")
    backtest_days = int(raw.get("backtest_days", DEFAULT_BACKTEST_DAYS))
    if not history_days <= backtest_days <= 5000:
        raise ValueError(f"{path}: backtest_days must be between history_days and 5000")

    return Watchlist(
        stocks=tuple(stocks),
        history_days=history_days,
        backtest_days=backtest_days,
        themes=tuple(themes),
    )
