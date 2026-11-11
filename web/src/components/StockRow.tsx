import type { ReactNode } from 'react';
import { priceOf, stockHref, useApp } from '../ctx';
import { baseCode, formatChange, formatPrice } from '../lib';
import type { StockSummary } from '../types';
import { ForecastBar } from './ForecastBar';
import { Spark } from './Spark';

interface Props {
  stock: StockSummary;
  /** Extra line under the name, e.g. position size. */
  sub?: ReactNode;
  /** Last cell: profit, themes or an action. */
  extra?: ReactNode;
  action?: ReactNode;
}

/** One line of a stock list: name, price, today's change, forecast and a sparkline. */
export function StockRow({ stock, sub, extra, action }: Props) {
  const { quotes } = useApp();
  const { price, change, live } = priceOf(stock, quotes);
  const chg = formatChange(change);
  return (
    <li className="row">
      <a className="row-name" href={stockHref(stock.code)}>
        <span className="row-title">{stock.name}</span>
        <span className="row-code">{sub ?? baseCode(stock.code)}</span>
      </a>
      <span className="row-price">
        <b>{formatPrice(price)}</b>
        <span className={chg.tone}>
          {chg.text}
          {live && <i className="live-dot" title="盤中即時" />}
        </span>
      </span>
      <span className="row-forecast">
        <ForecastBar forecast={stock.forecast} />
      </span>
      <span className="row-extra">{extra ?? <Spark values={stock.spark} />}</span>
      {action && <span className="row-action">{action}</span>}
    </li>
  );
}

export function RowHead({ extra, action }: { extra: string; action?: boolean }) {
  return (
    <li className="row row-head" aria-hidden="true">
      <span>名稱</span>
      <span className="row-price">價格</span>
      <span className="row-forecast">
        <span className="fhead">
          <span className="down">先跌</span>
          <span>未來一個月</span>
          <span className="up">先漲</span>
        </span>
      </span>
      <span className="row-extra">{extra}</span>
      {action && <span className="row-action" />}
    </li>
  );
}
