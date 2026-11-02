import { useMemo } from 'react';
import type { ViewProps } from './registry';
import { TrendChart } from './charts/TrendChart';
import {
  buildTrendPoints,
  lastMonthsTable,
  latestCompleteMonth,
  topCategories,
} from './trendsModel';
import './trends.css';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
const signedPercent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});

export function Trends({ snapshot }: ViewProps) {
  const { points, rows, month, categories } = useMemo(() => {
    const pts = buildTrendPoints(snapshot.cashflowMonthly);
    const today = new Date().toLocaleDateString('en-CA');
    const m = latestCompleteMonth(
      pts.map((p) => p.month),
      today,
    );
    return {
      points: pts,
      rows: lastMonthsTable(pts),
      month: m,
      categories: m ? topCategories(snapshot.spendingByCategory, m) : [],
    };
  }, [snapshot]);

  if (points.length === 0) {
    return (
      <section className="card" aria-labelledby="trend-title">
        <h2 id="trend-title">Cash-flow trend</h2>
        <p className="trends-empty">No cash-flow data in this snapshot.</p>
      </section>
    );
  }

  return (
    <>
      <section className="card" aria-labelledby="trend-title">
        <h2 id="trend-title">Cash-flow trend</h2>
        <TrendChart points={points} />
      </section>
      <div className="trends-grid">
        <section className="card" aria-labelledby="last6-title">
          <h2 id="last6-title">Last 6 months</h2>
          <table className="trends-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Income</th>
                <th scope="col">Expense</th>
                <th scope="col">Net</th>
                <th scope="col">Savings rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td>{usd.format(r.income)}</td>
                  <td>{usd.format(r.expense)}</td>
                  <td className={r.net < 0 ? 'trends-neg' : 'trends-pos'}>{usd.format(r.net)}</td>
                  <td>{percent.format(r.savingsRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card" aria-labelledby="topcat-title">
          <h2 id="topcat-title">Top categories{month ? `, ${month}` : ''}</h2>
          {categories.length === 0 ? (
            <p className="trends-empty">No category spending for this month.</p>
          ) : (
            <table className="trends-table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Spent</th>
                  <th scope="col">vs prior month</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td>{usd.format(c.amount)}</td>
                    <td className={c.change === null ? undefined : c.change > 0 ? 'trends-neg' : 'trends-pos'}>
                      {c.change === null ? 'new' : signedPercent.format(c.change)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
