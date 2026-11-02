import { describe, expect, it } from 'vitest';
import type { Paycheck } from './contract.ts';
import { countMissed } from './missed.ts';

const row = (over: Partial<Paycheck>): Paycheck => ({
  expectedDate: '2026-09-04',
  expectedAmount: 3200,
  receivedDate: null,
  receivedAmount: null,
  ...over,
});

describe('countMissed', () => {
  it('counts past-due rows with no deposit when there are no statuses', () => {
    const rows = [row({}), row({ expectedDate: '2026-09-18', receivedDate: '2026-09-18' }), row({ expectedDate: '2026-12-01' })];
    expect(countMissed(rows, '2026-11-01')).toBe(1);
  });

  it('counts only missed statuses once a ledger is present', () => {
    const rows = [
      row({ status: 'missed' }),
      row({ status: 'stub-only', expectedDate: '2026-09-18' }),
      row({ status: 'paid', expectedDate: '2026-10-02', receivedDate: '2026-10-02' }),
      row({ status: 'missed', expectedDate: '2026-12-01' }),
    ];
    expect(countMissed(rows, '2026-11-01')).toBe(1);
  });
});
