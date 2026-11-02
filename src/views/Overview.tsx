import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Snapshot } from '../data/contract';
import { countMissed } from '../data/missed';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

interface Kpi {
  label: string;
  value: string;
  hint: string;
}

function computeKpis(snapshot: Snapshot): Kpi[] {
  const latest = snapshot.cashflowMonthly.at(-1);
  const net = latest ? latest.income + latest.expense : 0;
  const savingsRate = latest && latest.income > 0 ? net / latest.income : 0;
  const cardDebt = snapshot.accounts
    .filter((a) => a.kind === 'credit' && a.balance < 0)
    .reduce((sum, a) => sum + a.balance, 0);
  const today = new Date().toLocaleDateString('en-CA');
  const missed = countMissed(snapshot.paychecks, today);
  return [
    { label: 'Net cash flow', value: usd.format(net), hint: latest?.month ?? 'no data' },
    { label: 'Card debt', value: usd.format(cardDebt), hint: 'credit balances owed' },
    { label: 'Savings rate', value: percent.format(savingsRate), hint: latest?.month ?? 'no data' },
    { label: 'Paychecks missed', value: String(missed), hint: 'not yet received' },
  ];
}

export function Overview({ snapshot }: { snapshot: Snapshot }) {
  const kpis = computeKpis(snapshot);
  return (
    <>
      <section className="kpis" aria-label="Key figures">
        {kpis.map((kpi) => (
          <div className="kpi" key={kpi.label}>
            <span className="kpi-label">{kpi.label}</span>
            <span className="kpi-value">{kpi.value}</span>
            <span className="kpi-hint">{kpi.hint}</span>
          </div>
        ))}
      </section>
      <section className="card" aria-labelledby="cashflow-title">
        <h2 id="cashflow-title">Monthly income vs expense</h2>
        <div className="chart" role="img" aria-label="Area chart of monthly income and expense in US dollars">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={snapshot.cashflowMonthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="month" stroke="var(--muted)" tick={{ fontSize: 12 }} />
              <YAxis
                stroke="var(--muted)"
                tick={{ fontSize: 12 }}
                width={64}
                tickFormatter={(v: number) => usd.format(v)}
              />
              <Tooltip
                formatter={(value: number, name: string) => [usd.format(value), name]}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="income"
                name="Income"
                stroke="var(--income)"
                fill="var(--income)"
                fillOpacity={0.25}
              />
              <Area
                type="monotone"
                dataKey="expense"
                name="Expense"
                stroke="var(--expense)"
                fill="var(--expense)"
                fillOpacity={0.25}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
