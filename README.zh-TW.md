# tw-stock-assistant

[English](README.md) | 繁體中文

自己架、自己用的台股與 ETF 投資助手。App 裡的名稱是「台股投資助手」。

| 功能 | 做什麼 |
| --- | --- |
| 總覽 | 大盤指數、你的持股、追蹤清單放在同一頁，最上面列出今天該先看的幾件事 |
| 漲跌機率 | 約 320 檔個股與 ETF，估未來 20 個交易日內「先漲 5%」和「先跌 5%」各有多少機會，附上原因和樣本外的準確度 |
| 看圖學型態 | K 線型態直接在圖上框起來、編號，每一種都有白話說明 |
| 選股 | 用代號或名稱搜尋，按題材篩選，按機率排序 |
| 持股 | 損益、移動停損參考價、幾條重要價位。資料可以只留在瀏覽器，也可以存到你自己的 Cloudflare，手機和電腦就會同步 |
| 每日摘要 | 開盤前、收盤後各一篇。只有持股風險明顯升高，或出現特別強的標的時才發通知 |
| 盤中報價 | 打開頁面或按更新時才抓，不會一直在背景跑 |

全部用免費額度就能跑：GitHub Actions 每天收盤後算一次，網站是放在 Cloudflare Pages 上的靜態 App，iPhone 可以加到主畫面當 App 用。

> 僅供學習與研究，不是投資建議。

## 怎麼運作

```
Yahoo Finance ──► GitHub Actions（台北時間 14:30 之後）
                    ├─ daily_stock_analysis 資料層        (vendor/)
                    ├─ 型態、訊號、機率模型                (pipeline/)
                    └─ 輸出 JSON ──► 靜態網站              (web/) ──► Cloudflare Pages
                                                             └─ /api/quote（Pages Function）──► 證交所盤中報價
```

| 路徑 | 內容 |
| --- | --- |
| `vendor/daily_stock_analysis` | [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)，以 Git submodule 固定在某個版本，沒有修改 |
| `pipeline/` | 抓日線、找型態、訓練機率模型、輸出 JSON |
| `config/universe.yaml` | 所有會分析的個股、ETF 和指數，按題材分組 |
| `config/watchlist.yaml` | App 一開始預設的追蹤清單 |
| `web/` | Vite + TypeScript + React，圖表用 TradingView Lightweight Charts |
| `web/functions/`、`web/server/` | Cloudflare Pages Functions，負責盤中報價和雲端同步 |
| `skills/` | Claude 寫摘要時參考的公開 Agent Skills |
| `.github/workflows/` | 排程、建置、部署 |

## 機率模型

每檔股票的每個交易日是一筆資料。特徵只用當天收盤前就知道的資訊：近期報酬、離均線多遠、波動、成交量、RSI、MACD、幾個規則訊號，還有加權指數當時的狀態。標籤是後來發生的事：20 個交易日內收盤價先漲 5%、先跌 5%，或兩邊都沒碰到。

所有股票合在一起訓練一個多項式邏輯迴歸。驗證時每一年都只用更早的資料來預測，所以 App「模型」頁上的數字是樣本外的結果，裡面也有校準表。程式在 `pipeline/forecast.py`。

## 選擇要分析哪些股票

在 `config/universe.yaml` 的某個題材底下加一行。台股代號要帶市場後綴，上市用 `.TW`，上櫃用 `.TWO`。

```yaml
themes:
  - key: foundry
    name: 晶圓代工與封測
    stocks:
      2330.TW: 台積電
```

股票池裡的股票，每個人都能在 App 裡用搜尋框加進自己的追蹤清單，清單存在瀏覽器。

## 在自己電腦上跑

```bash
git clone --recurse-submodules https://github.com/mxzhuang/tw-stock-assistant.git
cd tw-stock-assistant

python -m venv .venv && . .venv/bin/activate
pip install -r vendor/daily_stock_analysis/requirements.txt -r requirements.txt
python -m pipeline              # 從 Yahoo Finance 抓真實股價
python -m pipeline --demo       # 用假資料，不用連網

cd web && npm ci --ignore-scripts && npm run dev
```

測試：`python -m pytest`，以及 `cd web && npm test`。

## 架一個自己的

每一份都是一個人的網站，跑在他自己的 GitHub 和 Cloudflare 帳號裡，跟別人的互不相干。

1. 在 GitHub 按 **Use this template**，建立你的 repo。
2. 加 repository secrets（Settings → Secrets and variables → Actions）。填了哪一組就多開哪些功能，沒填的會自動跳過。

| Secrets | 得到什麼 |
| --- | --- |
| 都不填 | workflow 照跑，建好的網站可以從 artifact 下載 |
| `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | 一個你自己的公開網站，有圖表、選股、機率和盤中報價 |
| 再加 `SYNC_PASSWORD` | 持股和追蹤清單跨裝置同步、個人化的摘要、風險通知 |
| 再加 `CLAUDE_CODE_OAUTH_TOKEN` | 摘要改由 Claude Code 撰寫，會查當天新聞，並參考公開的財經 skill（見 `skills/README.md`） |

- Cloudflare token：dashboard → My Profile → API Tokens，權限要有 *Account → Cloudflare Pages → Edit*。要用同步的話再加 *Account → Workers KV Storage → Edit*。Account ID 在 Workers & Pages 頁面看得到。
- `SYNC_PASSWORD`：自己取一組密碼，每台裝置只要輸入一次，所以請用又長又亂的（16 個字元以上，用密碼管理器產生最省事）。別人能不能看到、改到你的持股就靠這組密碼；猜錯太多次會被暫時鎖住，但太短的密碼還是猜得出來。
- `CLAUDE_CODE_OAUTH_TOKEN`：在電腦上執行 `claude setup-token` 取得，需要有 Claude 訂閱。

3. 到 Actions 頁面手動執行一次 **daily**。之後平日台北時間 08:30 和 14:40 會自動跑。
4. 改 `config/universe.yaml` 和 `config/watchlist.yaml` 決定要分析什麼。需要改的只有這兩個檔案。

網站的網址會印在每次執行的最後，repo 頁面的 **Deployments** 也看得到。名稱沒人用過的話，網址是 `https://<repo 名稱>.pages.dev`；已經被別人用掉時，Cloudflare 會在後面加一小段。想自己指定名稱，設一個 repository variable `PAGES_PROJECT`。

摘要預設用 Claude Sonnet 寫。要換模型，設 repository variable `BRIEFING_MODEL`（例如 `opus`）。你的方案用不了指定的模型時，會退回 Claude Code 的預設模型。

### 同步、摘要與通知

設了 `SYNC_PASSWORD` 之後，workflow 會在你的 Cloudflare 帳號建一個 Workers KV namespace 並綁到網站上。持股、追蹤清單、推播訂閱和個人摘要都只存在那裡，不會進 repo，也不會出現在 workflow 的 log。公開的網站上只有一份不含持股的通用摘要。

只有出現新狀況才會發通知：持股收盤跌破移動停損價、持股的下跌機率明顯升高，或是出現少見的強勢標的。iPhone 要先把網站加到主畫面，網頁推播才會動。想測試的話，手動執行 workflow 並勾選「briefing」。

### 取得更新

用範本建出來的 repo 不會自動跟著原本的更新。要把後來的改動拉進來：

```bash
git remote add upstream https://github.com/mxzhuang/tw-stock-assistant.git
git fetch upstream && git merge upstream/main
```

如果你只改過 `config/` 底下的檔案，合併不會有衝突。

## 更新 daily_stock_analysis

Submodule 固定在上游的某一個 commit。要換成新版：

```bash
git -C vendor/daily_stock_analysis fetch --depth 1 origin main
git -C vendor/daily_stock_analysis checkout FETCH_HEAD
python -m pytest
git add vendor/daily_stock_analysis
git commit -m "chore(deps): bump daily_stock_analysis to <short sha>"
```

## 已知限制

- Yahoo Finance 的股價是還原權息之後的，比較早的 K 棒會跟多數券商 App 顯示的未還原價格不一樣。
- K 線型態描述的是已經發生的事，單獨拿來當買賣訊號並不可靠。
- 機率模型只看價和量，不知道財報、新聞或政策，比起直接用平均值猜，準確度只高一點。
- 只有寫在 `config/universe.yaml` 裡的代號搜尋得到。
- 盤中報價用的是證交所的公開端點，Cloudflare 連不上時，App 會顯示最近一個交易日的收盤價。

## 授權

MIT。詳見 [LICENSE](LICENSE)，第三方元件的聲明在 [NOTICE.md](NOTICE.md)。
