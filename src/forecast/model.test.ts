import { describe, expect, it } from 'vitest';
import type { CashflowMonth, RecurringItem } from '../data/contract.ts';
import { expandOccurrences, forecastCashflow, payDates } from './model.ts';

const rent: RecurringItem = {
  name: 'Rent',
  amount: -1000,
  frequency: 'monthly',
  category: 'Housing',
  nextDate: '2026-01-05',
};

const history: CashflowMonth[] = [
  { month: '2025-11', income: 3000, expense: -2000 },
  { month: '2025-12', income: 3400, expense: -2400 },
];

const schedule = { cadence: 'biweekly', anchorDate: '2026-01-02', expectedAmount: 1000 } as const;

describe('expandOccurrences', () => {
  const at = (frequency: RecurringItem['frequency'], nextDate: string, from: string, to: string) =>
    expandOccurrences({ frequency, nextDate }, from, to);

  it('steps weekly by real days', () => {
    expect(at('weekly', '2026-01-05', '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ]);
  });

  it('steps biweekly by real days', () => {
    expect(at('biweekly', '2026-01-05', '2026-01-01', '2026-02-28')).toEqual([
      '2026-01-05',
      '2026-01-19',
      '2026-02-02',
      '2026-02-16',
    ]);
  });

  it('lands semimonthly twice a month', () => {
    expect(at('semimonthly', '2026-01-01', '2026-01-01', '2026-02-28')).toEqual([
      '2026-01-01',
      '2026-01-16',
      '2026-02-01',
      '2026-02-16',
    ]);
  });

  it('clamps semimonthly second date in short months', () => {
    expect(at('semimonthly', '2026-01-15', '2026-02-01', '2026-02-28')).toEqual([
      '2026-02-15',
      '2026-02-28',
    ]);
  });

  it('clamps monthly to month end without drifting', () => {
    expect(at('monthly', '2026-01-31', '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('steps quarterly with clamping', () => {
    expect(at('quarterly', '2026-01-31', '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-04-30',
      '2026-07-31',
      '2026-10-31',
    ]);
  });

  it('steps semiyearly with clamping', () => {
    expect(at('semiyearly', '2026-08-31', '2026-01-01', '2027-12-31')).toEqual([
      '2026-08-31',
      '2027-02-28',
      '2027-08-31',
    ]);
  });

  it('steps yearly from a past nextDate, clamping a leap day', () => {
    expect(at('yearly', '2024-02-29', '2026-01-01', '2028-12-31')).toEqual([
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('drops occurrences before from', () => {
    expect(at('monthly', '2026-01-05', '2026-01-16', '2026-02-28')).toEqual(['2026-02-05']);
  });
});

describe('payDates', () => {
  it('counts three paychecks in a long month', () => {
    expect(payDates(schedule, '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
    ]);
  });

  it('walks back from an anchor in the future-or-past', () => {
    expect(payDates({ anchorDate: '2025-12-19' }, '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
    ]);
    expect(payDates({ anchorDate: '2026-03-13' }, '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
    ]);
  });
});

describe('forecastCashflow', () => {
  const base = { today: '2026-01-01', recurring: [rent], cashflowMonthly: history };

  it('defaults to a 12 month horizon starting at the current month', () => {
    const f = forecastCashflow({ ...base, paySchedule: schedule });
    expect(f.months).toHaveLength(12);
    expect(f.months[0]?.month).toBe('2026-01');
    expect(f.months[11]?.month).toBe('2026-12');
  });

  it('rolls over the year and honours horizonMonths', () => {
    const f = forecastCashflow({ ...base, today: '2026-11-01', horizonMonths: 4 });
    expect(f.months.map((m) => m.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('counts real pay dates, so 3-paycheck months show up', () => {
    const f = forecastCashflow({ ...base, paySchedule: schedule });
    expect(f.assumptions.incomeSource).toBe('pay-schedule');
    expect(f.assumptions.paychecksPerMonth['2026-01']).toBe(3);
    expect(f.assumptions.paychecksPerMonth['2026-02']).toBe(2);
    expect(f.assumptions.paychecksPerMonth['2026-07']).toBe(3);
    expect(Object.values(f.assumptions.paychecksPerMonth).reduce((a, b) => a + b, 0)).toBe(26);
    expect(f.months[0]?.income).toBe(3000);
    expect(f.months[1]?.income).toBe(2000);
    expect(f.months[6]?.income).toBe(3000);
  });

  it('computes fixed, flexible, net, band and cumulative net', () => {
    const f = forecastCashflow({ ...base, paySchedule: schedule });
    expect(f.assumptions.flexibleMonthlyAverage).toBe(1200);
    expect(f.assumptions.flexibleStdDev).toBe(282.84);
    expect(f.months[0]).toEqual({
      month: '2026-01',
      income: 3000,
      fixed: 1000,
      flexible: 1200,
      net: 800,
      low: 517.16,
      high: 1082.84,
      cumulativeNet: 800,
    });
    expect(f.months[1]?.net).toBe(-200);
    expect(f.months[1]?.cumulativeNet).toBe(600);
    expect(f.months[11]?.fixed).toBe(1000);
  });

  it('excludes the current partial month from the flexible average and prorates the first month', () => {
    const f = forecastCashflow({
      ...base,
      today: '2026-01-16',
      paySchedule: schedule,
      cashflowMonthly: [...history, { month: '2026-01', income: 1000, expense: -300 }],
    });
    expect(f.assumptions.trailingWindow).toEqual(['2025-11', '2025-12']);
    expect(f.assumptions.flexibleMonthlyAverage).toBe(1200);
    expect(f.months[0]?.flexible).toBe(619.35);
    expect(f.months[0]?.fixed).toBe(0);
    expect(f.months[0]?.income).toBe(2000);
    expect(f.months[1]?.fixed).toBe(1000);
    expect(f.months[1]?.flexible).toBe(1200);
  });

  it('widens the window with trailingMonths', () => {
    const f = forecastCashflow({
      ...base,
      trailingMonths: 3,
      cashflowMonthly: [{ month: '2025-10', income: 3000, expense: -1600 }, ...history],
    });
    expect(f.assumptions.trailingMonthsUsed).toBe(3);
    expect(f.assumptions.flexibleMonthlyAverage).toBe(1000);
    expect(f.assumptions.flexibleStdDev).toBe(400);
  });

  it('zeroes the band and warns with fewer than 2 trailing months', () => {
    const f = forecastCashflow({
      ...base,
      paySchedule: schedule,
      cashflowMonthly: history.slice(1),
    });
    expect(f.assumptions.trailingMonthsUsed).toBe(1);
    expect(f.assumptions.flexibleStdDev).toBe(0);
    expect(f.months.every((m) => m.low === m.net && m.high === m.net)).toBe(true);
    expect(f.warnings.some((w) => /band is 0/.test(w))).toBe(true);
  });

  it('falls back to positive recurring streams for income', () => {
    const salary: RecurringItem = {
      name: 'Paycheck',
      amount: 2000,
      frequency: 'monthly',
      category: 'Income',
      nextDate: '2026-01-10',
    };
    const f = forecastCashflow({ ...base, recurring: [rent, salary] });
    expect(f.assumptions.incomeSource).toBe('recurring');
    expect(f.months.every((m) => m.income === 2000 && m.fixed === 1000)).toBe(true);
  });

  it('falls back to the trailing average of cashflow income', () => {
    const f = forecastCashflow(base);
    expect(f.assumptions.incomeSource).toBe('trailing-average');
    expect(f.months.every((m) => m.income === 3200)).toBe(true);
  });

  it('averages flexible spend unfloored when a trailing month is below the bills', () => {
    const f = forecastCashflow({
      ...base,
      cashflowMonthly: [
        { month: '2025-11', income: 3000, expense: -500 },
        { month: '2025-12', income: 3000, expense: -2700 },
      ],
    });
    expect(f.assumptions.flexibleMonthlyAverage).toBe(600);
    expect(f.assumptions.flexibleStdDev).toBe(1555.63);
    expect(f.months[1]?.flexible).toBe(600);
  });

  it('floors the final flexible figure at 0', () => {
    const f = forecastCashflow({
      ...base,
      cashflowMonthly: [
        { month: '2025-11', income: 3000, expense: -500 },
        { month: '2025-12', income: 3000, expense: -700 },
      ],
    });
    expect(f.assumptions.flexibleMonthlyAverage).toBe(0);
    expect(f.months.every((m) => m.flexible === 0)).toBe(true);
  });

  it('skips invalid recurring items with a name-free warning', () => {
    const bad = (over: Partial<Record<keyof RecurringItem, unknown>>) =>
      ({ ...rent, name: 'SecretName', ...over }) as RecurringItem;
    const f = forecastCashflow({
      ...base,
      recurring: [
        rent,
        bad({ frequency: 'fortnightly' }),
        bad({ nextDate: '01/05/2026' }),
        bad({ amount: Number.NaN, nextDate: '2026-02-30' }),
        bad({ amount: Number.NaN }),
      ],
    });
    expect(f.months.every((m) => [m.income, m.fixed, m.flexible, m.net].every(Number.isFinite))).toBe(true);
    expect(f.months.every((m) => m.fixed === 1000)).toBe(true);
    expect(f.assumptions.flexibleMonthlyAverage).toBe(1200);
    const skipped = f.warnings.filter((w) => /skipped/.test(w));
    expect(skipped).toEqual([
      'recurring item 1 skipped: unknown frequency',
      'recurring item 2 skipped: invalid nextDate',
      'recurring item 3 skipped: invalid nextDate',
      'recurring item 4 skipped: non-finite amount',
    ]);
    expect(skipped.some((w) => /SecretName|1000/.test(w))).toBe(false);
  });

  it('ignores an unsupported pay schedule cadence and falls back', () => {
    const f = forecastCashflow({
      ...base,
      paySchedule: { ...schedule, cadence: 'monthly' } as unknown as typeof schedule,
    });
    expect(f.assumptions.incomeSource).toBe('trailing-average');
    expect(f.assumptions.paychecksPerMonth).toEqual({});
    expect(f.warnings).toContain('pay schedule cadence monthly not supported; using fallback income');
  });

  it('warns and zeroes income with no source at all', () => {
    const f = forecastCashflow({ today: '2026-01-01', recurring: [], cashflowMonthly: [] });
    expect(f.assumptions.incomeSource).toBe('none');
    expect(f.months.every((m) => m.income === 0)).toBe(true);
    expect(f.warnings.some((w) => /No income source/.test(w))).toBe(true);
  });
});
