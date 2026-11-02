import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import type { TrendPoint } from '../trendsModel';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export interface TrendChartProps<P extends TrendPoint = TrendPoint> {
  /**
   * Monthly rows in ascending `month` order. A caller may pass a subtype of `TrendPoint` with
   * extra optional fields (for example `netForecast`, `bandLow`/`bandHigh`) that the extra
   * series in `children` read by key.
   */
  points: readonly P[];
  /** Accessible description of the chart. */
  label?: string;
  /**
   * Extension point: extra Recharts series (`<Line>`, `<Area>`, `<Bar>`, `<ReferenceLine>`)
   * rendered inside the same `ComposedChart`, after the built-in series. The forecast band and
   * annotations plug in here, reading their own keys from `points`.
   */
  children?: ReactNode;
  height?: number;
}

/** Income and expense bars (expense as positive height), net line and dashed 3-month net average. */
export function TrendChart<P extends TrendPoint = TrendPoint>({
  points,
  label,
  children,
  height,
}: TrendChartProps<P>) {
  return (
    <div
      className="chart"
      style={height ? { height } : undefined}
      role="img"
      aria-label={label ?? 'Monthly income, expense, net and 3-month average net in US dollars'}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          <Bar dataKey="income" name="Income" fill="var(--income)" fillOpacity={0.7} />
          <Bar dataKey="expense" name="Expense" fill="var(--expense)" fillOpacity={0.7} />
          <Line
            type="monotone"
            dataKey="net"
            name="Net"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
          <Line
            type="monotone"
            dataKey="netAvg3"
            name="Net, 3-mo avg"
            stroke="var(--muted)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
          />
          {children}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
