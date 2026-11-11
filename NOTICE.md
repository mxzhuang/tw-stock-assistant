# Third-party notices

## daily_stock_analysis

This project uses [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)
as its analysis engine. It is included unmodified as a Git submodule under
`vendor/daily_stock_analysis` and is distributed under the MIT License:

> MIT License
>
> Copyright (c) 2026 ZhuLinsen

The full license text is in `vendor/daily_stock_analysis/LICENSE`. Any patches this
project applies to it at build time live in `patches/` and are documented there.

## Other dependencies

- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) — Apache License 2.0
- [TA-Lib](https://github.com/TA-Lib/ta-lib-python) — BSD 2-Clause License

Market data comes from Yahoo Finance via `yfinance`. Data is for personal
research and education only.

## Agent Skills used for the briefing

Unmodified copies under `skills/third_party/`, used as the analysis method
when Claude Code writes the briefing. See `skills/README.md` for the exact
files and commits.

- `morning-note` and `thesis-tracker` from
  [anthropics/financial-services](https://github.com/anthropics/financial-services),
  licensed under Apache-2.0
  (`skills/third_party/anthropic-financial-services/LICENSE`).
- `market-news-analyst` from
  [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills),
  Copyright (c) 2026 TraderMonty, licensed under MIT
  (`skills/third_party/claude-trading-skills/LICENSE`).
