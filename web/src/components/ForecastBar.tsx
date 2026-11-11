import type { Forecast } from '../types';

interface Props {
  forecast: Forecast | null | undefined;
  size?: 'sm' | 'lg';
}

const pct = (v: number) => Math.round(v * 100);

/**
 * The app's one recurring figure: green grows from the left with the chance of
 * falling first, red from the right with the chance of rising first. The small
 * ticks mark what is normal for this stock.
 */
export function ForecastBar({ forecast: f, size = 'sm' }: Props) {
  if (!f) return <span className="fbar is-empty">尚無預測</span>;
  const down = pct(f.down);
  const up = pct(f.up);
  return (
    <span className={`fbar ${size}`} role="img" aria-label={`先跌機率 ${down}%，先漲機率 ${up}%`}>
      <b className="fbar-n down">{down}</b>
      <svg className="fbar-track" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
        <rect className="fbar-bg" x="0" y="2" width="100" height="6" />
        <rect className="fbar-down" x="0" y="2" width={f.down * 100} height="6" />
        <rect className="fbar-up" x={100 - f.up * 100} y="2" width={f.up * 100} height="6" />
        {f.base_down != null && <rect className="fbar-tick down" x={f.base_down * 100 - 0.5} y="0" width="1" height="10" />}
        {f.base_up != null && <rect className="fbar-tick up" x={100 - f.base_up * 100 - 0.5} y="0" width="1" height="10" />}
      </svg>
      <b className="fbar-n up">{up}</b>
    </span>
  );
}
