# tw-invest-assistant

A personal assistant for Taiwan stocks and ETFs.

- **Overview**: market indices, your holdings and your tracking list on one
  page, with a short list of what deserves attention today.
- **Forecast**: for about 320 stocks and ETFs, the chance that the price first
  rises 5% or first falls 5% within the next 20 trading days, with the reasons
  and an out-of-sample accuracy report.
- **Charts for learning**: candlestick patterns are boxed and numbered on the
  chart, each with a plain-language explanation.
- **Screener**: search by code or name, filter by theme, sort by forecast.
- **Holdings**: profit and loss, a trailing-stop reference price and key
  levels. Kept in your browser, or synced across your devices through your own
  Cloudflare storage.
- **Briefings**: before the open and after the close, with a notification only
  when a holding is at clearly raised risk or a strong candidate appears.
- **Intraday quotes** on demand, when you open or refresh the page.

Everything runs on free tiers: GitHub Actions does the daily work after the
market closes, and the website is a static app on Cloudflare Pages.

> For learning and research only. Nothing here is investment advice.

## How it works

```
Yahoo Finance ──► GitHub Actions (after 14:30 Taipei)
                    ├─ daily_stock_analysis data layer   (vendor/)
                    ├─ patterns, signals, forecast model  (pipeline/)
                    └─ JSON export ──► static web app     (web/) ──► Cloudflare Pages
                                                             └─ /api/quote (Pages Function) ──► TWSE intraday quotes
```

| Path | What it is |
| --- | --- |
| `vendor/daily_stock_analysis` | [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis) as a pinned Git submodule, used unmodified |
| `pipeline/` | Fetches daily bars, detects patterns, fits the forecast model, writes JSON |
| `config/universe.yaml` | Every stock, ETF and index that is analysed, grouped by theme |
| `config/watchlist.yaml` | The tracking list the app starts with |
| `web/` | Vite + TypeScript + React app using TradingView Lightweight Charts |
| `web/functions/`, `web/server/` | Cloudflare Pages Functions: intraday quotes and cloud sync |
| `skills/` | Published Agent Skills the Claude-written briefing follows |
| `.github/workflows/` | Scheduled pipeline, build and deploy |

## The forecast model

Each trading day of each stock is one row. Its features use only what was known
at that day's close: recent returns, distance from moving averages, volatility,
volume, RSI, MACD, the rule-based signals and the state of the TAIEX. Its label
is what happened next: the close first rose 5%, first fell 5%, or did neither
within 20 trading days.

One multinomial logistic regression is fitted on all stocks together. It is
validated walk-forward: every calendar year is predicted by a model trained
only on earlier years. The app's 模型 page shows those out-of-sample results,
including a calibration table. See `pipeline/forecast.py`.

## Choosing what is analysed

Add a stock under a theme in `config/universe.yaml`. Taiwan symbols need a
market suffix: `.TW` for TWSE-listed and `.TWO` for TPEx-listed securities.

```yaml
themes:
  - key: foundry
    name: 晶圓代工與封測
    stocks:
      2330.TW: 台積電
```

In the app, anyone can build their own tracking list from these with the
search box; that list is stored in the browser.

## Run locally

```bash
git clone --recurse-submodules https://github.com/mxzhuang/tw-invest-assistant.git
cd tw-invest-assistant

python -m venv .venv && . .venv/bin/activate
pip install -r vendor/daily_stock_analysis/requirements.txt -r requirements.txt
python -m pipeline              # real prices from Yahoo Finance
python -m pipeline --demo       # synthetic prices, works offline

cd web && npm ci --ignore-scripts && npm run dev
```

Run the tests with `python -m pytest` and `cd web && npm test`.

## Set up your own copy

Each copy is one person's site, running in their own GitHub and Cloudflare
accounts. Nothing is shared with anyone else's copy.

1. Click **Use this template** on GitHub to create your repository.
2. Add repository secrets (Settings → Secrets and variables → Actions). Each
   group switches on more features; anything you leave out is simply skipped.

| Secrets | What you get |
| --- | --- |
| none | The workflow runs and keeps the built site as a downloadable artifact |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | A public site at `https://<repository-name>.pages.dev` with charts, screener, forecast and intraday quotes |
| + `SYNC_PASSWORD` | Holdings and tracking list synced across your devices, a personal briefing, and risk notifications |
| + `CLAUDE_CODE_OAUTH_TOKEN` | Briefings written by Claude Code with current news, following published finance skills (see `skills/README.md`) |

- **Cloudflare token**: dashboard → My Profile → API Tokens, with
  *Account → Cloudflare Pages → Edit*. For sync also add
  *Account → Workers KV Storage → Edit*. The account ID is shown under
  Workers & Pages.
- **`SYNC_PASSWORD`**: any password you choose. You type it once on each
  device. It protects your holdings from being changed by other visitors.
- **`CLAUDE_CODE_OAUTH_TOKEN`**: run `claude setup-token` on your computer
  (needs a Claude subscription).

3. Run the **daily** workflow once from the Actions tab. After that it runs on
   weekdays at 08:30 and 14:40 Taipei time.
4. Edit `config/universe.yaml` and `config/watchlist.yaml` to choose what is
   analysed. Those are the only files you need to change.

To use a different site name, set a repository variable `PAGES_PROJECT`.
The briefing uses Claude Sonnet by default; set a repository variable
`BRIEFING_MODEL` (for example `opus`) to change it. If the chosen model is
not available on your plan, the run falls back to Claude Code's default model.

### Sync, briefings and notifications

With `SYNC_PASSWORD` set, the workflow creates a Workers KV namespace in your
Cloudflare account and binds it to the site. Holdings, the tracking list, push
subscriptions and your personal briefing live there and nowhere else; they are
never committed or written to workflow logs. The public site only carries a
general briefing without holdings.

A push notification is sent only for something new: a holding that closes below
its trailing stop or whose downside chance is clearly raised, or an unusually
strong candidate. On iPhone, web push works only after the site is added to the
Home Screen. To test, run the workflow by hand with the "briefing" option.

### Getting updates

Repositories made from a template do not follow the original. To pull in later
changes:

```bash
git remote add upstream https://github.com/mxzhuang/tw-invest-assistant.git
git fetch upstream && git merge upstream/main
```

If you only edited files under `config/`, this merges without conflicts.

## Updating daily_stock_analysis

The submodule is pinned to one upstream commit. To move to a newer version:

```bash
git -C vendor/daily_stock_analysis fetch --depth 1 origin main
git -C vendor/daily_stock_analysis checkout FETCH_HEAD
python -m pytest
git add vendor/daily_stock_analysis
git commit -m "chore(deps): bump daily_stock_analysis to <short sha>"
```

## Known limitations

- Prices from Yahoo Finance are dividend-adjusted, so older bars can differ
  from the unadjusted prices shown by most Taiwanese broker apps.
- Candlestick patterns describe what happened; on their own they are weak
  buy or sell signals.
- The forecast only sees price and volume. It knows nothing about earnings,
  news or policy, and its edge over the base rate is modest.
- Only symbols listed in `config/universe.yaml` can be searched.
- Intraday quotes depend on the exchange's public endpoint answering requests
  from Cloudflare; when it does not, the app shows the last daily close.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for third-party notices.
