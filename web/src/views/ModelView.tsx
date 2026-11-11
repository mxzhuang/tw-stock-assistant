import { useEffect, useState } from 'react';
import { loadModel } from '../api';
import { formatRate } from '../lib';
import type { ModelData, ModelScore } from '../types';

function Calibration({ score, side }: { score: ModelScore; side: 'up' | 'down' }) {
  return (
    <div className="table-wrap">
      <table className="plain calib">
        <caption>模型說「先{side === 'up' ? '漲' : '跌'}」的機率，對照事後真的發生的比例</caption>
        <thead>
          <tr>
            <th scope="col">模型說的機率</th>
            <th scope="col" className="num">
              實際發生
            </th>
            <th scope="col">對照</th>
            <th scope="col" className="num hide-s">
              天數
            </th>
          </tr>
        </thead>
        <tbody>
          {score.calibration.map((row) => (
            <tr key={row.from}>
              <th scope="row">
                {Math.round(row.from * 100)}–{Math.round(row.to * 100)}%
              </th>
              <td className="num">{formatRate(row.actual)}</td>
              <td>
                <svg className={`calib-bar ${side}`} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                  <rect className="fbar-bg" x="0" y="2" width="100" height="6" />
                  <rect className="calib-actual" x="0" y="2" width={row.actual * 100} height="6" />
                  <rect className="fbar-tick" x={row.predicted * 100 - 0.5} y="0" width="1" height="10" />
                </svg>
              </td>
              <td className="num hide-s">{row.n.toLocaleString('zh-TW')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ModelView() {
  const [model, setModel] = useState<ModelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadModel()
      .then(setModel)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main className="view"><p className="state" role="alert">模型資料讀取失敗：{error}</p></main>;
  if (!model) return <main className="view"><p className="state">讀取中…</p></main>;

  const move = Math.round((model.move ?? 0.05) * 100);
  const horizon = model.horizon ?? 20;

  return (
    <main className="view prose">
      <header className="view-head">
        <h1>機率是怎麼算的，有多準</h1>
      </header>

      <section>
        <h2>它在回答什麼問題</h2>
        <p>
          從今天收盤價起算，未來 {horizon} 個交易日（大約一個月）內，收盤價會先漲 {move}%、先跌 {move}%，還是兩邊都沒碰到？
          每檔股票每天都有這三個機率，加起來是 100%。
        </p>
        <p>
          用「哪個先發生」而不是「會不會漲 {move}%」，是因為波動大的股票一個月內常常又漲 {move}% 又跌 {move}%，兩個都說會發生等於沒說。
          對持有的人來說，重要的是先碰到哪一邊。
        </p>
      </section>

      {!model.available ? (
        <section>
          <h2>目前沒有模型</h2>
          <p>歷史資料不夠，這次更新沒有估出機率。下一次每日更新會再試。</p>
        </section>
      ) : (
        <>
          <section>
            <h2>怎麼算</h2>
            <p>
              把 {model.symbols} 檔股票和 ETF 從 {model.from?.slice(0, 4)} 年到現在的每一天都當成一筆紀錄，共用了 {model.train_rows?.toLocaleString('zh-TW')} 筆來估計。
              每筆紀錄記下當天收盤時看得到的 {model.features?.length} 個狀態：最近漲跌多少、離月線季線多遠、波動大小、成交量、RSI、有沒有出現出貨或買進訊號、大盤的狀況；
              再記下之後一個月實際上先發生了什麼。
            </p>
            <p>
              模型是邏輯迴歸（logistic regression），一種把這些狀態加權後換算成機率的統計方法。選它是因為每個因素往哪邊推、推多少都看得到，個股頁上列的「因素」就是從這裡來的。算出來的數字會再對照過去的實際結果校正一次，避免模型過度自信。
            </p>
          </section>

          <section>
            <h2>有多準</h2>
            {model.validated && model.up && model.down ? (
              <>
                <p>
                  驗證方式是「只用以前的資料預測之後的一年」：例如預測 2024 年的每一天時，模型只看過 2023 年底以前的資料。
                  下面的數字全部來自這種模型沒看過的日子，共 {model.up.n.toLocaleString('zh-TW')} 筆。
                </p>
                <ul className="facts">
                  <li>
                    模型最看好的 10% 日子裡，實際先漲 {move}% 的有 <b className="up">{formatRate(model.up.top_decile)}</b>；
                    所有日子平均是 {formatRate(model.up.base)}，最不看好的 10% 是 {formatRate(model.up.bottom_decile)}。
                  </li>
                  <li>
                    模型認為最危險的 10% 日子裡，實際先跌 {move}% 的有 <b className="down">{formatRate(model.down.top_decile)}</b>；
                    所有日子平均是 {formatRate(model.down.base)}，最安全的 10% 是 {formatRate(model.down.bottom_decile)}。
                  </li>
                </ul>
                <p>
                  下面兩張表是校準：如果模型說 30–40%，事後真的發生的比例也該落在 30–40% 附近。色條是實際比例，細線是模型說的平均值，兩者越接近越好。最上面和最下面的格子天數少，誤差會比中間大。
                </p>
                <Calibration score={model.up} side="up" />
                <Calibration score={model.down} side="down" />
                <p className="fine">
                  給熟悉統計的人：先漲 AUC {model.up.auc?.toFixed(3)}、先跌 AUC {model.down.auc?.toFixed(3)}；
                  Brier skill（相對於永遠猜平均值）分別是 {model.up.skill?.toFixed(3)} 和 {model.down.skill?.toFixed(3)}。
                  0.5 的 AUC 等於亂猜，技術面模型通常只比 0.5 高一點。
                </p>
              </>
            ) : (
              <p>歷史資料還不夠做「用以前預測之後」的驗證，所以現在的機率還沒有準確度數字，請保守看待。</p>
            )}
          </section>

          <section>
            <h2>它做不到什麼</h2>
            <ul className="facts">
              <li>它只看價格和成交量。財報、法說會、政策、戰爭、匯率這些它完全不知道。</li>
              <li>它說的是「很多次類似情況」的平均結果。60% 代表十次裡大約四次不會發生，單看一次常常會錯。</li>
              <li>只靠價格和成交量能分辨的程度有限。上面的驗證數字就是它的實力，請不要把它當成比那更準的東西。</li>
              <li>過去十年台股整體是上漲的，模型學到的東西在長期空頭裡可能不適用。</li>
              <li>
                用來訓練和驗證的是「現在」還在、而且成交熱絡的股票。過去十年間下市或沒落的公司不在裡面，所以上面的數字會比實際情況樂觀一些，「先漲」那邊尤其如此（倖存者偏差）。
              </li>
              <li>這不是投資建議。買賣之前請自己判斷，尤其是停損價要在進場前先想好。</li>
            </ul>
          </section>

          {model.demo && <p className="fine">目前是示範資料，上面的準確度數字不是真實市場的結果。</p>}
        </>
      )}
    </main>
  );
}
