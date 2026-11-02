import type { CashflowMonth, CategorySpend } from '../data/contract';

/**
 * One month of the trend chart. `expense` is spend as a positive number (negative when refunds
 * exceed spend), so `net` is always income minus expense.
 */
export interface TrendPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
  /** Mean of `net` over this and the two previous calendar months, counting only months present. */
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

/**
 * Sorts by month, flips expense to spend-positive and adds the trailing 3-calendar-month average
 * of net. Months `>= beforeMonth` (`YYYY-MM`, the snapshot's month) are dropped because that
 * month is still partial.
 */
export function buildTrendPoints(
  cashflowMonthly: readonly CashflowMonth[],
  beforeMonth?: string,
): TrendPoint[] {
  const sorted = cashflowMonthly
    .filter((m) => beforeMonth === undefined || m.month < beforeMonth)
    .sort((a, b) => a.month.localeCompare(b.month));
  const netByMonth = new Map(sorted.map((m) => [m.month, m.income + m.expense]));
  return sorted.map((m) => {
    const window = [m.month, previousMonth(m.month), previousMonth(previousMonth(m.month))];
    const nets = window.flatMap((w) => netByMonth.get(w) ?? []);
    return {
      month: m.month,
      income: m.income,
      expense: -m.expense,
      net: m.income + m.expense,
      netAvg3: nets.reduce((s, n) => s + n, 0) / nets.length,
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

/** Per-category spend for `month` as positive dollars, net of refunds. */
function totalsByCategory(rows: readonly CategorySpend[], month: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.month !== month) continue;
    totals.set(r.category, (totals.get(r.category) ?? 0) - r.amount);
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
