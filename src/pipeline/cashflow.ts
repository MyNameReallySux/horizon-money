import type { CashflowMonth, CategorySpend } from '../data/contract.ts';
import { cents, isFiniteNumber, recordsAt, type Warn } from './raw.ts';

/** Which category groups count as income, and which are transfers excluded from both sides. */
export interface CashflowOptions {
  incomeGroups: readonly string[];
  excludedGroups: readonly string[];
}

export const DEFAULT_CASHFLOW_OPTIONS: CashflowOptions = {
  incomeGroups: ['Income', 'Irregular Income'],
  excludedGroups: ['Investment', 'Transfers'],
};

const toMonth = (date: unknown): string | null =>
  typeof date === 'string' && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null;

/**
 * Maps GetCashFlow grouped by month and category group. The raw rows carry no income/expense
 * type, so income is decided by group name: income groups sum into `income`, every other group
 * except the excluded ones sums into `expense` (net of refunds). Months are sorted ascending.
 */
export function mapCashflow(
  raw: unknown,
  options: CashflowOptions,
  warn: Warn,
): CashflowMonth[] {
  const rows = recordsAt(raw, ['data'], 'cashflow-monthly.json');
  const months = new Map<string, { income: number; expense: number }>();
  let skipped = 0;
  for (const row of rows) {
    const month = toMonth(row.month);
    if (month === null || typeof row.entity_name !== 'string' || !isFiniteNumber(row.amount)) {
      skipped++;
      continue;
    }
    if (options.excludedGroups.includes(row.entity_name)) continue;
    const bucket = months.get(month) ?? { income: 0, expense: 0 };
    if (options.incomeGroups.includes(row.entity_name)) bucket.income += row.amount;
    else bucket.expense += row.amount;
    months.set(month, bucket);
  }
  if (skipped > 0) warn(`skipped ${skipped} cash-flow row(s) with missing month, group or amount`);
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { income, expense }]) => ({
      month,
      income: cents(income),
      expense: cents(expense),
    }));
}

/**
 * Maps GetCashFlow grouped by month and category. With GetCategories output, categories are
 * assigned their group and any whose group is not an expense group are dropped; without it,
 * transfers cannot be told apart, so every category is kept under itself as the group.
 */
export function mapSpending(
  raw: unknown,
  categoriesRaw: unknown | undefined,
  warn: Warn,
): CategorySpend[] {
  const rows = recordsAt(raw, ['data'], 'spending-by-category.json');
  const groupOf = new Map<string, { group: string; type: string }>();
  if (categoriesRaw !== undefined) {
    for (const group of recordsAt(categoriesRaw, ['category_groups'], 'categories.json')) {
      if (typeof group.name !== 'string') continue;
      const type = typeof group.type === 'string' ? group.type : 'expense';
      const categories = Array.isArray(group.categories) ? group.categories : [];
      for (const cat of categories) {
        if (typeof cat === 'object' && cat !== null && typeof (cat as { name?: unknown }).name === 'string') {
          groupOf.set((cat as { name: string }).name, { group: group.name, type });
        }
      }
    }
  }

  const out: CategorySpend[] = [];
  let skipped = 0;
  let unmapped = 0;
  for (const row of rows) {
    const month = toMonth(row.month);
    if (month === null || typeof row.entity_name !== 'string' || !isFiniteNumber(row.amount)) {
      skipped++;
      continue;
    }
    let group = row.entity_name;
    if (categoriesRaw !== undefined) {
      const found = groupOf.get(row.entity_name);
      if (found === undefined) {
        unmapped++;
      } else {
        if (found.type !== 'expense') continue;
        group = found.group;
      }
    }
    out.push({ month, group, category: row.entity_name, amount: cents(row.amount) });
  }
  if (skipped > 0) warn(`skipped ${skipped} spending row(s) with missing month, category or amount`);
  if (unmapped > 0) warn(`${unmapped} spending row(s) have a category missing from categories.json`);
  return out.sort(
    (a, b) => a.month.localeCompare(b.month) || a.group.localeCompare(b.group) || a.category.localeCompare(b.category),
  );
}
