import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { theme } from '../theme';

/** One pattern to annotate: a box over its candles plus a numbered badge. */
export interface PatternMark {
  id: string;
  num: number;
  bullish: boolean;
  start: string; // YYYY-MM-DD
  end: string;
  top: number;
  bottom: number;
  label: string;
  selected: boolean;
}

interface Badge {
  id: string;
  x: number;
  y: number;
  num: number;
  color: string;
  selected: boolean;
}

interface Box {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  color: string;
  selected: boolean;
}

/** '#RRGGBB' -> 'rgba(r, g, b, a)'. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}


const R = 8; // badge radius, CSS px
const GAP = 6; // gap between a bar and its badge
const STACK = 2 * R + 3; // vertical step when several badges share a bar
const BOX_PAD = 4;

class MarksRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly badges: Badge[],
    private readonly boxes: Box[],
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      for (const b of this.boxes) this.drawBox(ctx, b, hr, vr);
      for (const b of this.badges) this.drawBadge(ctx, b, hr, vr);
    });
  }

  private drawBadge(ctx: CanvasRenderingContext2D, b: Badge, hr: number, vr: number): void {
    const x = b.x * hr;
    const y = b.y * vr;
    const r = R * Math.min(hr, vr);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = b.selected ? b.color : theme.surface;
    ctx.fill();
    ctx.lineWidth = Math.max(1, Math.round(1.25 * hr));
    ctx.strokeStyle = b.color;
    ctx.stroke();

    const text = String(b.num);
    ctx.font = `600 ${Math.round((text.length > 1 ? 9.5 : 11) * vr)}px ${theme.sans}`;
    ctx.fillStyle = b.selected ? theme.surface : b.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5 * vr);
  }

  private drawBox(ctx: CanvasRenderingContext2D, b: Box, hr: number, vr: number): void {
    const x = Math.round(b.x1 * hr);
    const y = Math.round(b.y1 * vr);
    const w = Math.max(1, Math.round((b.x2 - b.x1) * hr));
    const h = Math.max(1, Math.round((b.y2 - b.y1) * vr));
    if (b.selected) {
      ctx.fillStyle = theme.noteFill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = theme.note;
      ctx.lineWidth = Math.max(1, Math.round(1.75 * hr));
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = alpha(b.color, 0.6);
      ctx.lineWidth = Math.max(1, Math.round(1 * hr));
      ctx.setLineDash([Math.round(3 * hr), Math.round(2 * hr)]);
    }
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

}

class MarksView implements IPrimitivePaneView {
  badges: Badge[] = [];
  private boxes: Box[] = [];

  constructor(private readonly source: PatternMarks) {}

  update(): void {
    const param = this.source.param;
    this.badges = [];
    this.boxes = [];
    if (!param) return;

    const timeScale = param.chart.timeScale();
    const half = timeScale.options().barSpacing / 2;
    const stackCount = new Map<string, number>();
    const placed: Badge[] = [];

    // Selected first, then newest first, so they win when space runs out.
    const ordered = [...this.source.marks].sort(
      (a, b) => Number(b.selected) - Number(a.selected) || b.end.localeCompare(a.end),
    );

    for (const m of ordered) {
      const x = timeScale.timeToCoordinate(m.end);
      const yTop = param.series.priceToCoordinate(m.top);
      const yBottom = param.series.priceToCoordinate(m.bottom);
      if (x === null || yTop === null || yBottom === null) continue;

      const key = `${m.end}|${m.bullish ? 'below' : 'above'}`;
      const level = stackCount.get(key) ?? 0;
      const y = m.bullish ? yBottom + GAP + R + level * STACK : yTop - GAP - R - level * STACK;

      // Zoomed far out, badges would pile up: keep the ones placed first.
      const clash = placed.some((p) => Math.abs(p.x - x) < 2 * R && Math.abs(p.y - y) < 2 * R);
      if (clash && !m.selected) continue;
      stackCount.set(key, level + 1);
      const color = m.bullish ? theme.up : theme.down;
      placed.push({ id: m.id, x, y, num: m.num, color, selected: m.selected });

      const xs = timeScale.timeToCoordinate(m.start) ?? x;
      this.boxes.push({
        x1: xs - half,
        x2: x + half,
        y1: Math.min(yTop, yBottom) - BOX_PAD,
        y2: Math.max(yTop, yBottom) + BOX_PAD,
        color,
        selected: m.selected,
      });
    }
    // Draw the selected box and badge last so they sit on top.
    this.badges = placed.reverse();
    this.boxes.reverse();
  }

  zOrder() {
    return 'top' as const;
  }

  renderer(): IPrimitivePaneRenderer {
    return new MarksRenderer(this.badges, this.boxes);
  }
}

/** Boxes and numbered badges for the patterns in view; the selected one is highlighted. */
export class PatternMarks implements ISeriesPrimitive<Time> {
  param: SeriesAttachedParameter<Time> | null = null;
  marks: PatternMark[] = [];
  private readonly view = new MarksView(this);
  private readonly views = [this.view];

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param;
  }

  detached(): void {
    this.param = null;
  }

  setMarks(marks: PatternMark[]): void {
    this.marks = marks;
    this.param?.requestUpdate();
  }

  /** The badge under a point in CSS pixels, for click hit-testing. */
  hit(x: number, y: number): string | null {
    const found = this.view.badges.find((b) => (b.x - x) ** 2 + (b.y - y) ** 2 <= (R + 3) ** 2);
    return found?.id ?? null;
  }

  updateAllViews(): void {
    this.view.update();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}
