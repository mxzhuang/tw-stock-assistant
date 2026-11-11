import { dateSpan, patternId, shortDate } from '../lib';
import type { Catalog, Direction, PatternHit } from '../types';

export type Filter = 'all' | Direction;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'bull', label: '偏多' },
  { value: 'bear', label: '偏空' },
];

interface Props {
  patterns: PatternHit[];
  numbers: Map<string, number>;
  catalog: Catalog;
  filter: Filter;
  onFilter: (f: Filter) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  refYear: string;
  range: { from: string; to: string } | null;
}

export function PatternList({ patterns, numbers, catalog, filter, onFilter, selectedId, onSelect, refYear, range }: Props) {
  return (
    <section className="notes" aria-labelledby="notes-title">
      <div className="notes-head">
        <h2 id="notes-title">圖上標出的型態</h2>
        <div className="seg" role="group" aria-label="篩選方向">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => onFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="notes-hint">
        {range ? `畫面範圍 ${shortDate(range.from, refYear)}–${shortDate(range.to, refYear)}，共 ${patterns.length} 個。` : ''}
        縮放或拖動圖表，清單會跟著變。
      </p>

      {patterns.length === 0 ? (
        <p className="notes-empty">畫面中沒有{filter === 'all' ? '' : FILTERS.find((f) => f.value === filter)?.label}的型態。往左拖動或縮小圖表看看。</p>
      ) : (
        <ol className="pattern-list">
          {patterns.map((p) => {
            const info = catalog.patterns[p.key];
            const id = patternId(p);
            const open = id === selectedId;
            const noteId = `note-${id}`;
            return (
              <li key={id} className={open ? 'is-open' : undefined}>
                <button
                  type="button"
                  className="pattern-row"
                  aria-expanded={open}
                  aria-controls={noteId}
                  onClick={() => onSelect(open ? null : id)}
                >
                  <span className="pattern-title">
                    <span className={`pattern-num ${info?.direction === 'bull' ? 'up' : 'down'}`} aria-hidden="true">
                      {numbers.get(id)}
                    </span>
                    <span className="pattern-name">{info?.name ?? p.key}</span>
                  </span>
                  <span className={`pattern-dir ${info?.direction === 'bull' ? 'up' : 'down'}`}>
                    {info?.direction === 'bull' ? '偏多' : '偏空'}
                  </span>
                  <span className="pattern-date">{dateSpan(p, refYear)}</span>
                </button>
                {open && info && (
                  <div id={noteId} className="pattern-note">
                    <dl>
                      <dt>長什麼樣子</dt>
                      <dd>{info.shape}</dd>
                      <dt>通常代表</dt>
                      <dd>{info.meaning}</dd>
                      <dt>要注意</dt>
                      <dd>{info.caveat}</dd>
                    </dl>
                    {info.context_text && <p className="pattern-context">{info.context_text}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
