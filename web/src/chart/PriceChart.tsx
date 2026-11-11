import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { dateSpan, formatLots, formatPrice, formatRate, patternAt, patternId, toDateStr } from '../lib';
import { theme } from '../theme';
import type { Candle, StockData } from '../types';
import { PatternMarks, type PatternMark } from './PatternMarks';

/** Roughly 7px per bar so candles stay readable on phones; between 40 and 90 bars. */
function initialBars(width: number): number {
  return Math.max(40, Math.min(90, Math.round(width / 7)));
}
const MA_COLORS: Record<string, string> = { '5': theme.ma5, '20': theme.ma20, '60': theme.ma60 };

interface Props {
  data: StockData;
  /** Patterns to mark: the same filtered, numbered set the list shows. */
  marks: PatternMark[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onVisibleRange: (from: string, to: string) => void;
  /** Bumped by the parent to scroll the chart to the selected pattern. */
  focusToken: number;
}

interface Hover {
  candle: Candle;
  ma: Record<string, number | null>;
  up: number | null;
  down: number | null;
}

export function PriceChart({ data, marks, selectedId, onSelect, onVisibleRange, focusToken }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maRefs = useRef<Record<string, ISeriesApi<'Line'>>>({});
  const probRefs = useRef<{ up: ISeriesApi<'Line'>; down: ISeriesApi<'Line'> } | null>(null);
  const marksRef = useRef<PatternMarks | null>(null);
  const marksDataRef = useRef(marks);
  marksDataRef.current = marks;
  const callbacks = useRef({ onSelect, onVisibleRange });
  callbacks.current = { onSelect, onVisibleRange };
  const dataRef = useRef(data);
  dataRef.current = data;
  const [hover, setHover] = useState<Hover | null>(null);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.surface },
        textColor: theme.muted,
        fontFamily: theme.sans,
        fontSize: 12,
        attributionLogo: true,
        panes: { separatorColor: theme.rule, separatorHoverColor: theme.rule },
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: theme.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 3, minBarSpacing: 2 },
      localization: {
        locale: 'zh-TW',
        timeFormatter: (time: Time) => toDateStr(time).replaceAll('-', '/'),
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    for (const [window, color] of Object.entries(MA_COLORS)) {
      maRefs.current[window] = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }

    const volume = chart.addSeries(
      HistogramSeries,
      {
        // Values are in lots (張); show whole numbers.
        priceFormat: { type: 'custom', minMove: 1, formatter: (v: number) => formatLots(v * 1000) },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    chart.panes()[1]?.setHeight(80);

    const marker = new PatternMarks();
    candles.attachPrimitive(marker);

    const onRange = (range: LogicalRange | null) => {
      const visible = chart.timeScale().getVisibleRange();
      if (!range || !visible) return;
      callbacks.current.onVisibleRange(toDateStr(visible.from), toDateStr(visible.to));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    const onClick = (param: MouseEventParams<Time>) => {
      // A tap on a numbered badge wins; otherwise pick a marked pattern under that bar.
      const onBadge = param.point ? marker.hit(param.point.x, param.point.y) : null;
      if (onBadge) return callbacks.current.onSelect(onBadge);
      if (param.time === undefined) return;
      const hit = patternAt(marksDataRef.current, toDateStr(param.time));
      callbacks.current.onSelect(hit ? hit.id : null);
    };
    chart.subscribeClick(onClick);

    const onMove = (param: MouseEventParams<Time>) => {
      if (param.time === undefined || !param.point) {
        setHover(null);
        return;
      }
      const date = toDateStr(param.time);
      const d = dataRef.current;
      const i = d.candles.findIndex((c) => c.time === date);
      if (i < 0) return setHover(null);
      setHover({
        candle: d.candles[i],
        ma: Object.fromEntries(Object.entries(d.ma).map(([w, vals]) => [w, vals[i] ?? null])),
        up: d.prob?.up[i] ?? null,
        down: d.prob?.down[i] ?? null,
      });
    };
    chart.subscribeCrosshairMove(onMove);

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;
    marksRef.current = marker;

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      marksRef.current = null;
      maRefs.current = {};
      probRefs.current = null;
    };
  }, []);

  // Replace data when the stock changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleRef.current || !volumeRef.current) return;

    candleRef.current.setData(
      data.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    );
    volumeRef.current.setData(
      data.candles.map((c) => ({
        time: c.time,
        value: c.volume / 1000,
        color: c.close >= c.open ? theme.upSoft : theme.downSoft,
      })),
    );
    for (const [window, series] of Object.entries(maRefs.current)) {
      const values = data.ma[window] ?? [];
      series.setData(
        data.candles.map((c, i) => (values[i] == null ? { time: c.time } : { time: c.time, value: values[i]! })),
      );
    }

    // Third pane: how the two chances moved over time (out-of-sample history).
    if (data.prob && !probRefs.current) {
      const line = (color: string) =>
        chart.addSeries(
          LineSeries,
          {
            color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceFormat: { type: 'custom', minMove: 1, formatter: (v: number) => `${Math.round(v)}%` },
          },
          2,
        );
      probRefs.current = { down: line(theme.down), up: line(theme.up) };
      chart.panes()[2]?.setHeight(84);
    } else if (!data.prob && probRefs.current) {
      chart.removeSeries(probRefs.current.up);
      chart.removeSeries(probRefs.current.down);
      probRefs.current = null;
    }
    if (data.prob && probRefs.current) {
      for (const side of ['up', 'down'] as const) {
        const values = data.prob[side];
        probRefs.current[side].setData(
          data.candles.map((c, i) => (values[i] == null ? { time: c.time } : { time: c.time, value: values[i]! * 100 })),
        );
      }
    }

    const n = data.candles.length;
    const bars = initialBars(containerRef.current?.clientWidth ?? 800);
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars), to: n + 2 });
  }, [data]);

  // Redraw markers when the visible set or the selection changes.
  useEffect(() => {
    marksRef.current?.setMarks(marks);
  }, [marks]);

  // Scroll the selected pattern into view when asked.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !selectedId || focusToken === 0) return;
    const hit = data.patterns.find((p) => patternId(p) === selectedId);
    if (!hit) return;
    const index = data.candles.findIndex((c) => c.time === hit.end);
    const range = chart.timeScale().getVisibleLogicalRange();
    if (index < 0 || !range) return;
    if (index >= range.from + 2 && index <= range.to - 2) return; // already visible
    const width = range.to - range.from;
    chart.timeScale().setVisibleLogicalRange({ from: index - width / 2, to: index + width / 2 });
  }, [focusToken]);

  const last = data.candles[data.candles.length - 1];
  const shown = hover ?? {
    candle: last,
    ma: Object.fromEntries(Object.entries(data.ma).map(([w, v]) => [w, v[v.length - 1] ?? null])),
    up: data.prob?.up.at(-1) ?? null,
    down: data.prob?.down.at(-1) ?? null,
  };
  const c = shown.candle;
  const picked = marks.find((m) => m.selected);
  const tone = c.close >= c.open ? 'up' : 'down';

  return (
    <div className="chart">
      <div className="chart-legend" aria-live="off">
        <span className="legend-date">{c.time.replaceAll('-', '/')}</span>
        <span>
          開 <b className={tone}>{formatPrice(c.open)}</b>
        </span>
        <span>
          高 <b className={tone}>{formatPrice(c.high)}</b>
        </span>
        <span>
          低 <b className={tone}>{formatPrice(c.low)}</b>
        </span>
        <span>
          收 <b className={tone}>{formatPrice(c.close)}</b>
        </span>
        {data.kind !== 'index' && (
          <span>
            量 <b>{formatLots(c.volume)}</b> 張
          </span>
        )}
        <span className="legend-ma">
          {Object.entries(shown.ma).map(([w, v]) => (
            <span key={w} className={`ma${w}`}>
              MA{w} {formatPrice(v)}
            </span>
          ))}
        </span>
        {data.prob && (
          <span className="legend-ma">
            <span className="down">先跌 {formatRate(shown.down)}</span>
            <span className="up">先漲 {formatRate(shown.up)}</span>
          </span>
        )}
      </div>
      {picked && (
        <div className="chart-pick">
          <span className={`pattern-num is-filled ${picked.bullish ? 'up' : 'down'}`}>{picked.num}</span>
          <span className="chart-pick-name">{picked.label}</span>
          <span className="chart-pick-date">{dateSpan(picked)}</span>
          <button type="button" className="chart-pick-clear" onClick={() => onSelect(null)} aria-label="取消選取">
            ✕
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="chart-canvas"
        role="img"
        aria-label={`${data.name} 日K線圖，圓圈數字是偵測到的型態，點數字可以看說明`}
      />
      {data.prob && <p className="chart-foot">最下面一格是模型每天估的先漲（紅）、先跌（綠）機率。歷史上的值都是用當時以前的資料算的。</p>}
    </div>
  );
}
