import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { baseCode, searchStocks } from '../lib';
import type { StockSummary } from '../types';

interface Props {
  stocks: StockSummary[];
  onPick: (code: string) => void;
  placeholder: string;
  label: string;
  /** Codes to leave out of the results (already in the list being edited). */
  exclude?: string[];
}

const KIND: Record<string, string> = { etf: 'ETF', index: '指數', stock: '' };

export function SearchBox({ stocks, onPick, placeholder, label, exclude }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const results = useMemo(() => {
    const pool = exclude?.length ? stocks.filter((s) => !exclude.includes(s.code)) : stocks;
    return searchStocks(pool, query);
  }, [stocks, query, exclude]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const pick = (code: string) => {
    onPick(code);
    setQuery('');
    setOpen(false);
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="search" ref={boxRef}>
      <input
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter' && results[cursor]) {
            e.preventDefault();
            pick(results[cursor].code);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {showList && (
        <ul className="search-list" id={listId} role="listbox">
          {results.length === 0 ? (
            <li className="search-empty">找不到「{query.trim()}」。目前收錄約 {stocks.length} 檔常見的股票和 ETF。</li>
          ) : (
            results.map((s, i) => (
              <li key={s.code} role="option" aria-selected={i === cursor}>
                <button type="button" className={i === cursor ? 'is-cursor' : undefined} onClick={() => pick(s.code)}>
                  <span className="search-name">{s.name}</span>
                  <span className="search-code">
                    {baseCode(s.code)}
                    {KIND[s.kind] ? ` ${KIND[s.kind]}` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
