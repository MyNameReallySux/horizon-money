import { describe, expect, it } from 'vitest';
import accountsRaw from '../fixtures/raw/accounts.raw.json';
import paychecksRaw from '../fixtures/raw/paychecks.raw.json';
import { isSnapshot, type PaySchedule } from '../data/contract.ts';
import { buildSnapshot } from './build.ts';
import { buildPaycheckLedger, deriveSchedule } from './paychecks.ts';

describe('buildPaycheckLedger', () => {
  const schedule: PaySchedule = { cadence: 'biweekly', anchorDate: '2026-09-04', expectedAmount: 3200 };
  const today = '2026-10-31';

  it('marks paid, stub-only, deposit-only and missed per expected date', () => {
    const rows = buildPaycheckLedger(
      schedule,
      [
        { date: '2026-09-04', netPay: 3200 },
        { date: '2026-09-18', netPay: 3200 },
      ],
      [
        { date: '2026-09-05', amount: 3199 },
        { date: '2026-10-02', amount: 3200 },
      ],
      today,
    );
    expect(rows.map((r) => [r.expectedDate, r.status])).toEqual([
      ['2026-09-04', 'paid'],
      ['2026-09-18', 'stub-only'],
      ['2026-10-02', 'deposit-only'],
      ['2026-10-16', 'missed'],
      ['2026-10-30', 'missed'],
    ]);
    expect(rows[0]).toEqual({
      expectedDate: '2026-09-04',
      expectedAmount: 3200,
      receivedDate: '2026-09-05',
      receivedAmount: 3199,
      status: 'paid',
      stubNetPay: 3200,
    });
    expect(rows[1]).toMatchObject({ receivedDate: null, receivedAmount: null, stubNetPay: 3200 });
    expect(rows[2]).toMatchObject({ receivedDate: '2026-10-02', stubNetPay: null });
  });

  it('matches only within three days', () => {
    const rows = buildPaycheckLedger(
      schedule,
      [{ date: '2026-09-08', netPay: 3200 }],
      [{ date: '2026-09-01', amount: 3200 }],
      '2026-09-10',
    );
    expect(rows.map((r) => r.status)).toEqual(['deposit-only', 'off-cycle']);
  });

  it('keeps off-schedule stubs and deposits as off-cycle, pairing a nearby stub and deposit', () => {
    const rows = buildPaycheckLedger(
      schedule,
      [
        { date: '2026-09-04', netPay: 3200 },
        { date: '2026-09-25', netPay: 900 },
        { date: '2026-10-09', netPay: 500 },
      ],
      [
        { date: '2026-09-04', amount: 3200 },
        { date: '2026-09-26', amount: 880 },
        { date: '2026-10-20', amount: 40 },
      ],
      '2026-10-10',
    );
    const off = rows.filter((r) => r.status === 'off-cycle');
    expect(off.map((r) => [r.expectedDate, r.receivedDate, r.stubNetPay])).toEqual([
      ['2026-09-25', '2026-09-26', 900],
      ['2026-10-09', null, 500],
      ['2026-10-20', '2026-10-20', null],
    ]);
    expect(off[0]).toMatchObject({ expectedAmount: 900, receivedAmount: 880 });
  });

  it('excludes future expected dates', () => {
    expect(buildPaycheckLedger(schedule, [], [], '2026-09-17').map((r) => r.status)).toEqual(['missed']);
  });
});

describe('deriveSchedule', () => {
  it('anchors on the latest stub and expects the median net pay', () => {
    const schedule = deriveSchedule([
      { date: '2026-09-18', netPay: 3200 },
      { date: '2026-10-02', netPay: 9000 },
      { date: '2026-09-04', netPay: 3000 },
    ]);
    expect(schedule).toEqual({ cadence: 'biweekly', anchorDate: '2026-10-02', expectedAmount: 3200 });
  });

  it('averages the middle pair for an even count', () => {
    const schedule = deriveSchedule([
      { date: '2026-09-04', netPay: 3000 },
      { date: '2026-09-18', netPay: 3201 },
    ]);
    expect(schedule?.expectedAmount).toBe(3100.5);
  });

  it('is undefined without stubs', () => expect(deriveSchedule([])).toBeUndefined());
});

describe('buildSnapshot with a pay stub index', () => {
  const now = new Date('2026-11-01T09:00:00Z');
  const stub = (payDate: string, voucherNumber: string) => ({
    payDate,
    netPay: 3200,
    checkNumber: '1',
    voucherNumber,
    file: null,
    source: 'oasis',
  });
  const index = {
    version: 1,
    updatedAt: '2026-11-01T00:00:00.000Z',
    stubs: [stub('2026-09-04', 'V-1'), stub('2026-10-16', 'V-2')],
  };

  it('derives the schedule from stubs and reconciles with deposits', () => {
    const { snapshot } = buildSnapshot({ accounts: accountsRaw, paychecks: paychecksRaw, paystubs: index }, { now });
    expect(isSnapshot(snapshot)).toBe(true);
    expect(snapshot).not.toHaveProperty('paySchedule');
    expect(snapshot.paychecks.map((p) => [p.expectedDate, p.status])).toEqual([
      ['2026-09-04', 'paid'],
      ['2026-09-18', 'deposit-only'],
      ['2026-10-02', 'missed'],
      ['2026-10-16', 'paid'],
      ['2026-10-30', 'deposit-only'],
    ]);
  });

  it('prefers the manual pay schedule over the derived one', () => {
    const manual = {
      version: 1,
      accounts: [],
      paySchedule: { cadence: 'biweekly', anchorDate: '2026-09-11', expectedAmount: 1 },
    };
    const { snapshot } = buildSnapshot({ accounts: accountsRaw, paystubs: index, manual }, { now });
    expect(snapshot.paychecks.some((p) => p.expectedDate === '2026-09-11' && p.expectedAmount === 1)).toBe(true);
  });

  it('works without deposits, with a warning', () => {
    const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, paystubs: index }, { now });
    expect(snapshot.paychecks.some((p) => p.status === 'stub-only')).toBe(true);
    expect(warnings).toContain('paychecks.json is missing; paychecks are reconciled without deposits');
  });

  it('rejects a malformed index', () => {
    expect(() => buildSnapshot({ accounts: accountsRaw, paystubs: { version: 9 } }, { now })).toThrow(/pay stub index/);
  });

  it('leaves paychecks without status when no index is given', () => {
    const manual = {
      version: 1,
      accounts: [],
      paySchedule: { cadence: 'biweekly', anchorDate: '2026-09-04', expectedAmount: 3200 },
    };
    const { snapshot } = buildSnapshot({ accounts: accountsRaw, paychecks: paychecksRaw, manual }, { now });
    expect(snapshot.paychecks.every((p) => !('status' in p) && !('stubNetPay' in p))).toBe(true);
  });
});
