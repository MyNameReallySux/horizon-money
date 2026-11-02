import type { CashflowMonth, CategorySpend } from '../data/contract';

/** One month of the trend chart. `expense` is a positive magnitude, `net` is income minus expense. */
export interface TrendPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
  /** Trailing 3-month mean of `net`; averaged over fewer months at the start of the series. */
  netAvg3: number;
}

export interface TableRow {
  month: string;
  income: number;
  expense: number;
  net: number;
  /** `net / income`, or 0 when there is no income. */
  savingsRate: number;
}

export interface CategoryRow {
  category: string;
  /** Positive dollars spent in the month. */
  amount: number;
  /** Positive dollars spent in the previous month. */
  previous: number;
  /** Fractional change vs the previous month; null when the previous month had no spend. */
  change: number | null;
}

const WINDOW = 3;

/** Sorts by month, converts expense to a positive magnitude and adds the trailing 3-month average of net. */
export function buildTrendPoints(cashflowMonthly: readonly CashflowMonth[]): TrendPoint[] {
  const sorted = [...cashflowMonthly].sort((a, b) => a.month.localeCompare(b.month));
  const nets = sorted.map((m) => m.income + m.expense);
  return sorted.map((m, i) => {
    const slice = nets.slice(Math.max(0, i - WINDOW + 1), i + 1);
    return {
      month: m.month,
      income: m.income,
      expense: Math.abs(m.expense),
      net: m.income + m.expense,
      netAvg3: slice.reduce((s, n) => s + n, 0) / slice.length,
    };
  });
}

/** The last `count` points as table rows, oldest first. */
export function lastMonthsTable(points: readonly TrendPoint[], count = 6): TableRow[] {
  return points.slice(-count).map((p) => ({
    month: p.month,
    income: p.income,
    expense: p.expense,
    net: p.net,
    savingsRate: p.income > 0 ? p.net / p.income : 0,
  }));
}

/**
 * Latest month strictly before the month of `today` (`YYYY-MM-DD`), since the current month is
 * still partial. Falls back to the latest month when every month is the current or a later one.
 */
export function latestCompleteMonth(months: readonly string[], today: string): string | undefined {
  const sorted = [...months].sort();
  const current = today.slice(0, 7);
  return sorted.filter((m) => m < current).at(-1) ?? sorted.at(-1);
}

function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function totalsByCategory(rows: readonly CategorySpend[], month: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.month !== month) continue;
    totals.set(r.category, (totals.get(r.category) ?? 0) + Math.max(0, -r.amount));
  }
  return totals;
}

/** Top `limit` categories by spend in `month`, largest first, with change against the previous calendar month. */
export function topCategories(
  spendingByCategory: readonly CategorySpend[],
  month: string,
  limit = 5,
): CategoryRow[] {
  const current = totalsByCategory(spendingByCategory, month);
  const prior = totalsByCategory(spendingByCategory, previousMonth(month));
  return [...current.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, amount]) => {
      const previous = prior.get(category) ?? 0;
      return { category, amount, previous, change: previous > 0 ? (amount - previous) / previous : null };
    });
}
