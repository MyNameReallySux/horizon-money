import { describe, expect, it } from 'vitest';
import type { CategorySpend } from '../data/contract';
import {
  buildTrendPoints,
  lastMonthsTable,
  latestCompleteMonth,
  topCategories,
} from './trendsModel';

const cf = (month: string, income: number, expense: number) => ({ month, income, expense });
const spend = (month: string, category: string, amount: number): CategorySpend => ({
  month,
  group: 'g',
  category,
  amount,
});

describe('buildTrendPoints', () => {
  it('returns an empty list for empty data', () => {
    expect(buildTrendPoints([])).toEqual([]);
  });

  it('sorts, flips expense positive and computes net', () => {
    const [a, b] = buildTrendPoints([cf('2025-02', 100, -40), cf('2025-01', 200, -50)]);
    expect(a).toMatchObject({ month: '2025-01', income: 200, expense: 50, net: 150 });
    expect(b).toMatchObject({ month: '2025-02', expense: 40, net: 60 });
  });

  it('averages over fewer months at the series start', () => {
    const pts = buildTrendPoints([
      cf('2025-01', 100, -40),
      cf('2025-02', 100, -70),
      cf('2025-03', 100, -100),
      cf('2025-04', 100, -10),
    ]);
    expect(pts.map((p) => p.netAvg3)).toEqual([60, 45, 30, (30 + 0 + 90) / 3]);
  });
});

describe('lastMonthsTable', () => {
  it('keeps the last six months and reports a zero savings rate with no income', () => {
    const pts = buildTrendPoints([
      cf('2025-01', 100, -50),
      cf('2025-02', 100, -50),
      cf('2025-03', 100, -50),
      cf('2025-04', 100, -50),
      cf('2025-05', 100, -50),
      cf('2025-06', 100, -50),
      cf('2025-07', 0, -50),
    ]);
    const rows = lastMonthsTable(pts);
    expect(rows).toHaveLength(6);
    expect(rows[0]?.month).toBe('2025-02');
    expect(rows[0]?.savingsRate).toBe(0.5);
    expect(rows[5]?.savingsRate).toBe(0);
  });

  it('handles empty input', () => {
    expect(lastMonthsTable([])).toEqual([]);
  });
});

describe('latestCompleteMonth', () => {
  it('skips the current partial month', () => {
    expect(latestCompleteMonth(['2025-03', '2025-05', '2025-04'], '2025-05-10')).toBe('2025-04');
  });

  it('falls back to the latest month and handles empty data', () => {
    expect(latestCompleteMonth(['2025-05'], '2025-05-10')).toBe('2025-05');
    expect(latestCompleteMonth([], '2025-05-10')).toBeUndefined();
  });
});

describe('topCategories', () => {
  it('returns the top five by spend with month-over-month change', () => {
    const rows = [
      spend('2025-01', 'A', -100),
      spend('2025-01', 'B', -50),
      spend('2025-02', 'A', -150),
      spend('2025-02', 'B', -25),
      spend('2025-02', 'C', -300),
      spend('2025-02', 'D', -10),
      spend('2025-02', 'E', -20),
      spend('2025-02', 'F', -30),
      spend('2025-02', 'G', -5),
    ];
    const top = topCategories(rows, '2025-02');
    expect(top.map((r) => r.category)).toEqual(['C', 'A', 'F', 'B', 'E']);
    expect(top[1]).toMatchObject({ amount: 150, previous: 100, change: 0.5 });
    expect(top[3]?.change).toBe(-0.5);
    expect(top[0]?.change).toBeNull();
  });

  it('wraps the previous month across a year boundary and sums duplicate rows', () => {
    const rows = [
      spend('2024-12', 'A', -100),
      spend('2025-01', 'A', -60),
      spend('2025-01', 'A', -40),
    ];
    expect(topCategories(rows, '2025-01').at(0)).toMatchObject({ amount: 100, previous: 100, change: 0 });
  });

  it('ignores refunds and returns nothing for empty or unknown months', () => {
    expect(topCategories([spend('2025-01', 'A', 20)], '2025-01')).toEqual([]);
    expect(topCategories([], '2025-01')).toEqual([]);
  });
});
