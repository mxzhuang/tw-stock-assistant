"""Command line entry point: ``python -m pipeline --out web/public/data``."""

from __future__ import annotations

import argparse
import logging
from collections import Counter
import sys
from pathlib import Path

from .config import INDEX, WATCH, Stock, load_watchlist
from .export import (
    SCHEMA_VERSION,
    build_stock_payload,
    catalog_payload,
    now_taipei,
    stock_filename,
    summarize,
    themes_payload,
    write_json,
)
from .patterns import detect
from .signals import signal_masks

ROOT = Path(__file__).resolve().parent.parent
MARKET_CODE = "TWII"
MIN_BARS = 60  # enough for a chart; the forecast needs about a year and is skipped until then
log = logging.getLogger("pipeline")


def _fetch(fetcher, stock: Stock, days: int):
    """Daily bars for a stock; if the board suffix is wrong, try the other board."""
    try:
        bars = fetcher.daily_bars(stock.symbol, days)
        if len(bars) < MIN_BARS:
            raise ValueError(f"only {len(bars)} bars returned")
        return stock, bars
    except Exception as first:
        other = stock.with_other_suffix()
        if other is None:
            raise
        try:
            bars = fetcher.daily_bars(other.symbol, days)
            if len(bars) < MIN_BARS:
                raise ValueError(f"only {len(bars)} bars returned")
        except Exception:
            raise first from None
        log.warning("%s was found as %s; fix the suffix in the config", stock.code, other.code)
        return other, bars


def run(
    watchlist_path: Path,
    out_dir: Path,
    fetcher=None,
    demo: bool = False,
    universe_path: Path | None = None,
) -> int:
    from .forecast import Series, run_forecast  # noqa: PLC0415  (imports scikit-learn)

    watchlist = load_watchlist(watchlist_path, universe_path)
    if demo:
        from .demo import DemoFetcher  # noqa: PLC0415

        fetcher = DemoFetcher()
    elif fetcher is None:
        from .fetch import DailyBarFetcher  # noqa: PLC0415  (heavy vendor import)

        fetcher = DailyBarFetcher()

    stocks_dir = out_dir / "stocks"
    prepared: list[tuple[Stock, object, list]] = []
    series: list[Series] = []
    errors: list[dict] = []

    for listed in watchlist.stocks:
        try:
            stock, bars = _fetch(fetcher, listed, watchlist.backtest_days)
            detections = detect(bars)
            prepared.append((stock, bars, detections))
            series.append(
                Series(
                    code=stock.code,
                    trainable=stock.kind != INDEX,
                    bars=bars,
                    masks=signal_masks(bars, detections),
                )
            )
        except Exception as exc:  # one bad symbol must not stop the rest
            log.error("%s: %s", listed.code, exc)
            errors.append(
                {
                    "code": listed.code,
                    "name": listed.name,
                    "market": listed.market,
                    "role": listed.role,
                    "kind": listed.kind,
                    "themes": list(listed.themes),
                    "error": str(exc)[:200],
                }
            )

    if not prepared:
        log.error("every symbol failed")
        return 1

    market_bars = next((bars for stock, bars, _ in prepared if stock.code == MARKET_CODE), None)
    try:
        forecasts, model = run_forecast(series, market_bars)
    except Exception:  # the charts are still useful without the forecast
        log.exception("forecast model failed")
        forecasts, model = {}, {"available": False}

    # The Taiwan market's latest two trading dates, from the symbols themselves.
    taiwan = [bars["date"] for stock, bars, _ in prepared if stock.kind != INDEX and len(bars) > 1]
    session = None
    if taiwan:
        latest = Counter(d.iloc[-1] for d in taiwan).most_common(1)[0][0]
        before = Counter(d.iloc[-2] for d in taiwan if d.iloc[-1] == latest).most_common(1)[0][0]
        session = (latest, before)

    summaries: list[dict] = []
    for stock, bars, detections in prepared:
        payload = build_stock_payload(
            stock, bars, watchlist.history_days, detections, forecasts.get(stock.code)
        )
        payload["demo"] = demo
        write_json(stocks_dir / stock_filename(stock.code), payload)
        summaries.append(summarize(payload, session if stock.kind != INDEX else None))
    log.info("%d symbols written, %d failed", len(summaries), len(errors))
    last_dates = sorted({s["last_date"] for s in summaries if s["kind"] != INDEX})
    log.info("latest daily bar: %s (oldest among symbols: %s)", last_dates[-1], last_dates[0])

    keep = {stock_filename(s["code"]) for s in summaries}
    for stale in stocks_dir.glob("*.json"):
        if stale.name not in keep:
            stale.unlink()

    generated_at = now_taipei()
    write_json(out_dir / "catalog.json", catalog_payload())
    write_json(out_dir / "model.json", {"schema": SCHEMA_VERSION, "generated_at": generated_at, "demo": demo, **model})
    write_json(
        out_dir / "index.json",
        {
            "schema": SCHEMA_VERSION,
            "generated_at": generated_at,
            "demo": demo,
            "themes": themes_payload(watchlist.themes),
            "defaults": [s["code"] for s in summaries if s["role"] == WATCH],
            "forecast": {
                "available": bool(model.get("available")),
                "validated": bool(model.get("validated")),
                "horizon": model.get("horizon"),
                "move": model.get("move"),
            },
            "stocks": summaries + errors,
        },
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watchlist", type=Path, default=ROOT / "config" / "watchlist.yaml")
    parser.add_argument("--universe", type=Path, default=ROOT / "config" / "universe.yaml")
    parser.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "data")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="use synthetic prices instead of Yahoo Finance (for offline development)",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return run(args.watchlist, args.out, demo=args.demo, universe_path=args.universe)


if __name__ == "__main__":
    sys.exit(main())
