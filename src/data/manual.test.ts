import { describe, expect, it } from 'vitest';
import example from '../../docs/manual.example.json';
import { isManualEntry } from './manual.ts';

const account = { id: 'manual-card', name: 'Test Card', kind: 'credit', balance: -100, asOf: '2026-10-01' };
const valid = { version: 1, accounts: [account] };

describe('isManualEntry', () => {
  it('accepts the documented example', () => {
    expect(isManualEntry(example)).toBe(true);
  });

  it('accepts accounts only, with or without apr', () => {
    expect(isManualEntry(valid)).toBe(true);
    expect(isManualEntry({ ...valid, accounts: [{ ...account, apr: 24.99 }] })).toBe(true);
  });

  it('accepts a valid pay schedule', () => {
    const paySchedule = { cadence: 'biweekly', anchorDate: '2026-06-05', expectedAmount: 2500 };
    expect(isManualEntry({ ...valid, paySchedule })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a wrong version', { ...valid, version: 2 }],
    ['accounts not an array', { ...valid, accounts: {} }],
    ['an unknown kind', { ...valid, accounts: [{ ...account, kind: 'cash' }] }],
    ['a non-numeric balance', { ...valid, accounts: [{ ...account, balance: '5' }] }],
    ['a missing asOf', { ...valid, accounts: [{ ...account, asOf: undefined }] }],
    ['a malformed asOf', { ...valid, accounts: [{ ...account, asOf: '10/01/2026' }] }],
    ['a non-numeric apr', { ...valid, accounts: [{ ...account, apr: '9' }] }],
    ['duplicate ids', { ...valid, accounts: [account, account] }],
    ['a weekly cadence', { ...valid, paySchedule: { cadence: 'weekly', anchorDate: '2026-06-05', expectedAmount: 1 } }],
    ['a bad anchor date', { ...valid, paySchedule: { cadence: 'biweekly', anchorDate: 'soon', expectedAmount: 1 } }],
  ])('rejects %s', (_label, value) => {
    expect(isManualEntry(value)).toBe(false);
  });
});
