import { useCallback, useEffect, useState } from 'react';
import { SignIn } from '../components/SignIn';
import { useApp } from '../ctx';
import { disablePush, enablePush, pushState, showTestNotification, type PushState } from '../push';
import { addDevice, loadSetup, removeDevice, type Setup } from '../sync';

const STATE_TEXT: Record<PushState, string> = {
  unsupported: '這個瀏覽器目前不能收通知。iPhone 要先把網站加入主畫面，再從主畫面打開。',
  off: '這台裝置還沒開啟通知。',
  blocked: '通知被封鎖了。請到系統設定 → 通知，允許這個 App。',
  on: '這台裝置會收到通知。',
};

export function NotifyView() {
  const { sync } = useApp();
  const [state, setState] = useState<PushState>('off');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    void loadSetup().then(setSetup);
  }, []);

  const refresh = useCallback(async () => setState(await pushState()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const turnOn = async () => {
    if (!sync.password || !sync.vapidPublic) return;
    setBusy(true);
    setMessage(null);
    try {
      const sub = await enablePush(sync.vapidPublic);
      const { devices } = await addDevice(sync.password, sub);
      setMessage(`這台裝置的通知已開啟。目前共有 ${devices} 台裝置會收到通知。`);
    } catch (e) {
      setMessage((e as Error).message);
    }
    setBusy(false);
    void refresh();
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await disablePush();
      if (sub && sync.password) await removeDevice(sync.password, sub);
      setMessage('這台裝置不會再收到通知。');
    } catch (e) {
      setMessage((e as Error).message);
    }
    setBusy(false);
    void refresh();
  };

  return (
    <main className="view prose">
      <header className="view-head">
        <h1>同步與通知</h1>
        <p>
          持股、追蹤清單和每日摘要會在你登入過的裝置之間同步。平常不會發通知；只有持股的風險明顯升高，或出現特別強的標的時，才會推播。
        </p>
      </header>

      <section>
        <h2>同步</h2>
        {sync.available === null && <p className="quiet">檢查中…</p>}
        {sync.available === false && (
          <p>
            這個網站還沒有開啟同步，所以持股只存在這台裝置，也沒有通知。架站的人要在 GitHub 新增 <code>SYNC_PASSWORD</code> 這個 secret，並讓
            Cloudflare 的 API token 有 Workers KV Storage 的編輯權限，下一次部署後就會開啟。
          </p>
        )}
        {sync.available && !sync.signedIn && <SignIn why="輸入你設定的同步密碼。每台裝置只要輸入一次。" />}
        {sync.signedIn && (
          <>
            <p>這台裝置已登入。在任何一台改了持股或追蹤清單，其他裝置重新整理就會看到。</p>
            {sync.error && <p className="form-error">{sync.error}</p>}
            <div className="actions">
              <button type="button" className="follow" onClick={sync.signOut}>
                登出這台裝置
              </button>
            </div>
            <p className="fine">登出只會讓這台裝置停止同步，雲端的資料和其他裝置不受影響。</p>
          </>
        )}
      </section>

      <section>
        <h2>什麼時候會通知</h2>
        <ul className="facts">
          <li>持股收盤跌破移動停損參考價。</li>
          <li>持股或大盤「先跌 5%」的機率到 40% 以上，而且明顯高於平常。</li>
          <li>追蹤清單裡的股票「先漲 5%」的機率到 50% 以上，而且明顯高於平常。</li>
          <li>其他股票要更嚴格：先漲機率 60% 以上、比平常高 20 個百分點、先跌機率不到 20%。</li>
        </ul>
        <p className="fine">同一件事只通知一次，狀況解除後再發生才會再通知。機率來自統計模型，準確度有限，通知是提醒你去看，不是買賣指令。</p>
      </section>

      {sync.signedIn && (
        <section>
          <h2>這台裝置的通知</h2>
          <p>{STATE_TEXT[state]}</p>
          <div className="actions">
            {state !== 'on' ? (
              <button type="button" className="primary" onClick={turnOn} disabled={busy || state === 'unsupported' || state === 'blocked'}>
                開啟通知
              </button>
            ) : (
              <>
                <button type="button" className="follow" onClick={() => void showTestNotification()}>
                  顯示測試通知
                </button>
                <button type="button" className="follow" onClick={turnOff} disabled={busy}>
                  關閉這台的通知
                </button>
              </>
            )}
          </div>
          <p className="fine">iPhone：用 Safari 打開網站，按「分享」→「加入主畫面」，再從主畫面的圖示打開，才能開通知。</p>
          {message && (
            <p className="verdict" role="status">
              {message}
            </p>
          )}
        </section>
      )}
      <section>
        <h2>這個網站開了哪些功能</h2>
        <ul className="checks">
          <li className="is-on">
            <b>看盤、選股、機率、盤中報價</b>
            <span>已開啟。</span>
          </li>
          <li className={sync.available ? 'is-on' : 'is-off'}>
            <b>跨裝置同步、個人化摘要、風險通知</b>
            <span>{sync.available ? '已開啟。' : '未開啟。需要 SYNC_PASSWORD，以及 Cloudflare token 的 Workers KV Storage 編輯權限。'}</span>
          </li>
          <li className={setup?.claude ? 'is-on' : 'is-off'}>
            <b>由 Claude 撰寫摘要並查時事</b>
            <span>
              {setup?.claude
                ? '已開啟。'
                : '未開啟，目前的摘要由固定規則產生。在電腦執行 claude setup-token，把得到的 token 存成 CLAUDE_CODE_OAUTH_TOKEN 就會開啟。'}
            </span>
          </li>
        </ul>
        <p className="fine">這些是在 GitHub 專案的 Settings → Secrets and variables → Actions 設定的，改完要等下一次部署才會生效。</p>
      </section>
    </main>
  );
}
