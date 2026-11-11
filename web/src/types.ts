export type Direction = 'bull' | 'bear';
export type SignalKind = 'risk' | 'opportunity';
export type Kind = 'stock' | 'etf' | 'index';

export interface Candle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // shares
}

export interface PatternHit {
  key: string;
  start: string;
  end: string;
  top: number;
  bottom: number;
}

export interface SignalStat {
  n: number;
  k: number;
  p: number | null;
  base: number | null;
  lift: number | null;
  show: boolean;
  strong: boolean;
}

export interface ActiveSignal extends SignalStat {
  key: string;
  kind: SignalKind;
  date: string;
}

export interface StockSignals {
  horizon: number;
  move: number;
  history_from: string;
  base: Record<SignalKind, number | null>;
  stats: Record<string, SignalStat>;
  active: ActiveSignal[];
}

/** Chance that the close first rises / first falls by `move` within `horizon` bars. */
export interface Forecast {
  up: number;
  down: number;
  base_up: number | null;
  base_down: number | null;
}

export interface Reason {
  key: string;
  text: string;
}

export interface StockForecast extends Forecast {
  why_up: Reason[];
  why_down: Reason[];
}

export interface Levels {
  ma20: number | null;
  ma60: number | null;
  high60: number | null;
  low60: number | null;
  low20: number | null;
  atr: number | null;
  atr_pct: number | null;
  trail_stop: number | null;
  trail_bars: number;
  trail_atr: number;
}

export interface StockData {
  schema: number;
  code: string;
  name: string;
  market: string;
  role: 'watch' | 'pool';
  kind: Kind;
  themes: string[];
  price_adjusted: boolean;
  updated_at: string;
  demo?: boolean;
  candles: Candle[];
  ma: Record<string, (number | null)[]>;
  patterns: PatternHit[];
  forecast: StockForecast | null;
  prob: { up: (number | null)[]; down: (number | null)[] } | null;
  levels: Levels;
  signals: StockSignals;
  avg_volume_lots: number | null;
}

export interface PatternInfo {
  key: string;
  name: string;
  direction: Direction;
  bars: number;
  shape: string;
  meaning: string;
  caveat: string;
  context: 'up' | 'down' | null;
  context_text: string | null;
}

export interface SignalInfo {
  key: string;
  kind: SignalKind;
  name: string;
  rule: string;
}

export interface Catalog {
  schema: number;
  patterns: Record<string, PatternInfo>;
  signals: {
    horizon: number;
    move: number;
    min_samples_show: number;
    min_samples_strong: number;
    strong_lift: number;
    signals: Record<string, SignalInfo>;
  };
}

export interface StockSummary {
  code: string;
  name: string;
  market: string;
  role?: 'watch' | 'pool';
  kind: Kind;
  themes: string[];
  last_date?: string;
  last_close?: number;
  change_pct?: number | null;
  month_pct?: number | null;
  spark?: number[];
  recent_patterns?: string[];
  avg_volume_lots?: number | null;
  forecast?: Forecast | null;
  trail_stop?: number | null;
  active?: { key: string; kind: SignalKind; date: string }[];
  error?: string;
}

export interface Theme {
  key: string;
  name: string;
  kind: 'stock' | 'etf';
}

export interface IndexData {
  schema: number;
  generated_at: string;
  demo?: boolean;
  themes: Theme[];
  defaults: string[];
  forecast: { available: boolean; validated: boolean; horizon: number | null; move: number | null };
  stocks: StockSummary[];
}

export interface CalibrationRow {
  from: number;
  to: number;
  n: number;
  predicted: number;
  actual: number;
}

export interface ModelScore {
  n: number;
  base: number;
  auc: number | null;
  skill: number | null;
  top_decile: number;
  bottom_decile: number;
  calibration: CalibrationRow[];
}

export interface ModelData {
  schema: number;
  generated_at: string;
  demo?: boolean;
  available: boolean;
  validated?: boolean;
  horizon?: number;
  move?: number;
  train_rows?: number;
  symbols?: number;
  from?: string;
  to?: string;
  folds?: { year: number; train_rows: number }[];
  features?: { key: string; text: string | null; up: number; down: number }[];
  up?: ModelScore;
  down?: ModelScore;
}

export interface Holding {
  code: string;
  shares: number;
  cost: number; // average cost per share, TWD
}

/** Intraday quote from the optional /api/quote function. */
export interface Quote {
  price: number;
  prev: number;
  change_pct: number;
  time: string; // HH:MM
  date: string; // YYYY-MM-DD
  /** True when it came from the slower fallback source. */
  delayed?: boolean;
}

export interface BriefingItem {
  code?: string;
  title?: string;
  text: string;
  tone?: 'up' | 'down' | 'info';
  /** Holdings only: what the review concluded. */
  action?: '續抱' | '觀察' | '減碼' | '出場';
}

/** The pre-open / post-close write-up. */
export interface Briefing {
  headline: string;
  holdings: BriefingItem[];
  market: BriefingItem[];
  events?: BriefingItem[];
  picks: BriefingItem[];
  advice: BriefingItem[];
  /** Situations that warrant a notification; `notify` lists the ones that were new. */
  alerts?: { key: string; kind: 'risk' | 'pick'; text: string }[];
  notify?: string[];
  /** Published Agent Skills the write-up followed. */
  skills?: string[];
  /** Which Claude model wrote it. */
  model?: string;
}

export interface BriefingFile {
  schema: number;
  slot: 'pre' | 'post';
  generated_at: string;
  data_date: string;
  source: 'claude' | 'rules';
  personal: boolean;
  body: Briefing;
}
