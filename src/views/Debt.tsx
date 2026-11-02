import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { debtsFromAccounts } from '../payoff/avalanche';
import type { ViewProps } from './registry';
import { buildDebtViewModel, defaultBudgets } from './debtModel';
import './debt.css';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const LINE_COLORS = ['var(--expense)', 'var(--accent)', 'var(--income)'];

export function Debt({ snapshot }: ViewProps) {
  const defaults = useMemo(() => defaultBudgets(debtsFromAccounts(snapshot.accounts).debts), [snapshot]);
  const [edited, setEdited] = useState<(string | undefined)[]>([]);
  const inputs = defaults.map((d, i) => edited[i] ?? String(d));
  const budgets = inputs.map((s) => (s.trim() === '' ? Number.NaN : Number(s)));
  const model = useMemo(
    () => buildDebtViewModel(snapshot, budgets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, budgets.join(',')],
  );

  if (!model.hasDebt) {
    return (
      <section className="card" aria-labelledby="debt-empty-title">
        <h2 id="debt-empty-title">Debt payoff</h2>
        <p className="debt-note">No credit or loan balances in this snapshot.</p>
      </section>
    );
  }

  const longest = Math.max(0, ...model.scenarios.map((s) => s.balances.length));
  const data = Array.from({ length: longest }, (_, m) => {
    const row: Record<string, number> = { month: m };
    model.scenarios.forEach((s, i) => {
      const balance = s.balances[m];
      if (s.feasible && balance !== undefined) row[`s${i}`] = balance;
    });
    return row;
  });
  const middleBudget = model.scenarios[1]?.budget ?? Number.NaN;

  return (
    <>
      <section className="kpis" aria-label="Debt key figures">
        <div className="kpi">
          <span className="kpi-label">Total balance</span>
          <span className="kpi-value">{usd.format(model.kpis.totalBalance)}</span>
          <span className="kpi-hint">cards and loans</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Average APR</span>
          <span className="kpi-value">{model.kpis.weightedApr.toFixed(1)}%</span>
          <span className="kpi-hint">weighted by balance</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Interest burn</span>
          <span className="kpi-value">{usd.format(model.kpis.monthlyInterest)}</span>
          <span className="kpi-hint">estimated interest this month</span>
        </div>
      </section>

      <section className="card" aria-labelledby="debt-scenarios-title">
        <h2 id="debt-scenarios-title">Payoff scenarios</h2>
        <div className="debt-budgets">
          {inputs.map((value, i) => (
            <label className="debt-budget" key={i}>
              Monthly budget {i + 1}
              <input
                type="number"
                min={0}
                step={50}
                value={value}
                onChange={(e) => {
                  const next = [...edited];
                  next[i] = e.target.value;
                  setEdited(next);
                }}
              />
            </label>
          ))}
        </div>
        <div className="chart" role="img" aria-label="Line chart of total remaining debt by month for three monthly budgets">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis
                dataKey="month"
                stroke="var(--muted)"
                tick={{ fontSize: 12 }}
                label={{ value: 'Months from now', position: 'insideBottom', offset: -2, fontSize: 12 }}
              />
              <YAxis
                stroke="var(--muted)"
                tick={{ fontSize: 12 }}
                width={64}
                tickFormatter={(v: number) => usd.format(v)}
              />
              <Tooltip
                formatter={(value: number, name: string) => [usd.format(value), name]}
                labelFormatter={(m: number) => `Month ${m}`}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              />
              <Legend />
              {model.scenarios.map((s, i) =>
                s.feasible ? (
                  <Line
                    key={i}
                    type="monotone"
                    dataKey={`s${i}`}
                    name={`${usd.format(s.budget)}/mo`}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    dot={false}
                    connectNulls={false}
                  />
                ) : null,
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {model.scenarios.map((s, i) => (
          <p className="debt-note" key={i}>
            {Number.isFinite(s.budget) ? usd.format(s.budget) : 'Blank'}/mo:{' '}
            {s.feasible
              ? `debt-free ${s.finalMonth} (${s.months} months), ${usd.format(s.totalInterest)} interest`
              : 'not feasible: budget does not cover minimums or interest.'}
          </p>
        ))}
      </section>

      <section className="card" aria-labelledby="debt-cards-title">
        <h2 id="debt-cards-title">
          Per-card plan at {Number.isFinite(middleBudget) ? usd.format(middleBudget) : 'a blank budget'}/mo
        </h2>
        <table className="debt-table">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Balance</th>
              <th scope="col">APR</th>
              <th scope="col">Minimum</th>
              <th scope="col">Payoff month</th>
              <th scope="col">Interest paid</th>
            </tr>
          </thead>
          <tbody>
            {model.cards.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{usdCents.format(c.balance)}</td>
                <td>{c.apr.toFixed(2)}%</td>
                <td>{usdCents.format(c.minPayment)}</td>
                <td>{c.payoffMonth ?? 'not within plan'}</td>
                <td>{usdCents.format(c.interestPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {model.warnings.map((w) => (
          <p className="debt-note" key={w}>
            {w}
          </p>
        ))}
      </section>
    </>
  );
}
