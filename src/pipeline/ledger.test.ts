import { describe, expect, it } from 'vitest';
import accountsRaw from '../fixtures/raw/accounts.raw.json';
import paychecksRaw from '../fixtures/raw/paychecks.raw.json';
import { isSnapshot, type PaySchedule } from '../data/contract.ts';
import { buildSnapshot } from './build.ts';
import { buildPaycheckLedger, deriveSchedule } from './paychecks.ts';

describe('buildPaycheckLedger', () => {
  const schedule: PaySchedule = { cadence: 'biweekly', anchorDate: '2026-09-04', expectedAmount: 3200 };
  const today = '2026-10-31';

  it('marks paid, stub-only, deposit-only and missed per slot', () => {
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
      daysLate: 1,
    });
    expect(rows[1]).toMatchObject({ receivedDate: null, receivedAmount: null, stubNetPay: 3200, daysLate: 0 });
    expect(rows[2]).toMatchObject({ receivedDate: '2026-10-02', stubNetPay: null });
    expect(rows[3]).not.toHaveProperty('daysLate');
  });

  it('maps payments that land two to five days late to their slot with daysLate', () => {
    const rows = buildPaycheckLedger(
      schedule,
      [
        { date: '2026-09-06', netPay: 3200 },
        { date: '2026-09-21', netPay: 3200 },
        { date: '2026-10-07', netPay: 3200 },
        { date: '2026-10-19', netPay: 3200 },
      ],
      [
        { date: '2026-09-07', amount: 3200 },
        { date: '2026-09-22', amount: 3200 },
        { date: '2026-10-07', amount: 3200 },
        { date: '2026-10-20', amount: 3200 },
      ],
      today,
    );
    expect(rows.map((r) => [r.expectedDate, r.status, r.daysLate])).toEqual([
      ['2026-09-04', 'paid', 3],
      ['2026-09-18', 'paid', 4],
      ['2026-10-02', 'paid', 5],
      ['2026-10-16', 'paid', 4],
      ['2026-10-30', 'missed', undefined],
    ]);
  });

  it('reads a payment before its slot as negative daysLate', () => {
    const rows = buildPaycheckLedger(schedule, [{ date: '2026-09-02', netPay: 3200 }], [], '2026-09-10');
    expect(rows[0]).toMatchObject({ expectedDate: '2026-09-04', status: 'stub-only', daysLate: -2 });
  });

  it('keeps an item with no slot within six days as off-cycle', () => {
    const rows = buildPaycheckLedger(schedule, [{ date: '2026-09-11', netPay: 3200 }], [], '2026-09-20');
    expect(rows.map((r) => [r.expectedDate, r.status])).toEqual([
      ['2026-09-11', 'off-cycle'],
      ['2026-09-18', 'missed'],
    ]);
  });

  it('makes a mid-cycle bonus off-cycle and a second stub for one slot off-cycle', () => {
    const rows = buildPaycheckLedger(
      schedule,
      [
        { date: '2026-09-04', netPay: 3200 },
        { date: '2026-09-06', netPay: 400 },
        { date: '2026-09-11', netPay: 1000 },
        { date: '2026-09-18', netPay: 3200 },
      ],
      [],
      '2026-09-20',
    );
    expect(rows.map((r) => [r.expectedDate, r.status, r.stubNetPay])).toEqual([
      ['2026-09-04', 'stub-only', 3200],
      ['2026-09-06', 'off-cycle', 400],
      ['2026-09-11', 'off-cycle', 1000],
      ['2026-09-18', 'stub-only', 3200],
    ]);
  });

  it('pairs an off-cycle stub with a deposit within three days of it', () => {
    const rows = buildPaycheckLedger(
      schedule,
      [
        { date: '2026-09-04', netPay: 3200 },
        { date: '2026-09-25', netPay: 900 },
        { date: '2026-10-09', netPay: 500 },
      ],
      [
        { date: '2026-09-04', amount: 3200 },
        { date: '2026-09-25', amount: 880 },
        { date: '2026-10-20', amount: 40 },
      ],
      '2026-10-10',
    );
    const off = rows.filter((r) => r.status === 'off-cycle');
    expect(off.map((r) => [r.expectedDate, r.receivedDate, r.stubNetPay])).toEqual([
      ['2026-09-25', '2026-09-25', 900],
      ['2026-10-09', null, 500],
      ['2026-10-20', '2026-10-20', null],
    ]);
    expect(off[0]).toMatchObject({ expectedAmount: 900, receivedAmount: 880 });
  });

  it('excludes future slots', () => {
    expect(buildPaycheckLedger(schedule, [], [], '2026-09-17').map((r) => r.status)).toEqual(['missed']);
  });
});

describe('deriveSchedule', () => {
  it('anchors on the slot at or before the latest stub and expects the median net pay', () => {
    const schedule = deriveSchedule([
      { date: '2026-09-18', netPay: 3200 },
      { date: '2026-10-02', netPay: 9000 },
      { date: '2026-09-04', netPay: 3000 },
    ]);
    expect(schedule).toEqual({ cadence: 'biweekly', anchorDate: '2026-10-02', expectedAmount: 3200 });
  });

  it('picks the right phase when the latest stub is late', () => {
    const schedule = deriveSchedule([
      { date: '2026-09-04', netPay: 3200 },
      { date: '2026-09-18', netPay: 3200 },
      { date: '2026-10-02', netPay: 3200 },
      { date: '2026-10-16', netPay: 3200 },
      { date: '2026-11-02', netPay: 3200 },
    ]);
    expect(schedule?.anchorDate).toBe('2026-10-30');
  });

  it('fits the recent regular run and warns when fewer than three stubs qualify', () => {
    const messages: string[] = [];
    const schedule = deriveSchedule(
      [
        { date: '2026-09-04', netPay: 3000 },
        { date: '2026-09-18', netPay: 3201 },
      ],
      (m) => messages.push(m),
    );
    expect(schedule?.expectedAmount).toBe(3100.5);
    expect(messages).toHaveLength(1);
  });

  it('does not warn when a regular run exists', () => {
    const messages: string[] = [];
    deriveSchedule(
      [
        { date: '2026-09-04', netPay: 3200 },
        { date: '2026-09-18', netPay: 3200 },
        { date: '2026-10-02', netPay: 3200 },
      ],
      (m) => messages.push(m),
    );
    expect(messages).toEqual([]);
  });

  it('is undefined without stubs', () => expect(deriveSchedule([])).toBeUndefined());

  it('takes the phase from the recent regular run and shows an older irregular stretch against it', () => {
    const stubs = [
      { date: '2026-05-04', netPay: 3200 },
      { date: '2026-05-20', netPay: 3200 },
      { date: '2026-06-05', netPay: 700 },
      { date: '2026-06-26', netPay: 3200 },
      { date: '2026-08-07', netPay: 3200 },
      { date: '2026-08-21', netPay: 3200 },
      { date: '2026-09-04', netPay: 3200 },
      { date: '2026-09-18', netPay: 3200 },
    ];
    const schedule = deriveSchedule(stubs)!;
    expect(schedule.anchorDate).toBe('2026-09-18');
    const rows = buildPaycheckLedger(schedule, stubs.map((s) => ({ date: s.date, netPay: s.netPay })), [], '2026-09-20');
    expect(rows.map((r) => [r.expectedDate, r.status, r.daysLate])).toEqual([
      ['2026-05-01', 'stub-only', 3],
      ['2026-05-15', 'stub-only', 5],
      ['2026-05-29', 'missed', undefined],
      ['2026-06-05', 'off-cycle', undefined],
      ['2026-06-12', 'missed', undefined],
      ['2026-06-26', 'stub-only', 0],
      ['2026-07-10', 'missed', undefined],
      ['2026-07-24', 'missed', undefined],
      ['2026-08-07', 'stub-only', 0],
      ['2026-08-21', 'stub-only', 0],
      ['2026-09-04', 'stub-only', 0],
      ['2026-09-18', 'stub-only', 0],
    ]);
  });
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
    const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, paychecks: paychecksRaw, paystubs: index }, { now });
    expect(isSnapshot(snapshot)).toBe(true);
    expect(warnings).toContain('fewer than 3 recent regular pay stubs; pay schedule fitted on all stubs');
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
