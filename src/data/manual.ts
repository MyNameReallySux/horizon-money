import type { AccountKind, PaySchedule } from './contract.ts';

/** Version of the `manual.json` format; `isManualEntry` rejects other versions. */
export const MANUAL_VERSION = 1;

const KINDS: readonly AccountKind[] = [
  'checking',
  'savings',
  'credit',
  'loan',
  'investment',
  'property',
  'other',
];

/** One hand-maintained account, for institutions Monarch cannot sync. */
export interface ManualAccount {
  /** Unique across manual and Monarch accounts; pick something that cannot be a Monarch id. */
  id: string;
  name: string;
  kind: AccountKind;
  /** Dollars; negative for money owed, same as `Account.balance`. */
  balance: number;
  /** Percent (19.99 means 19.99%), for debt accounts. */
  apr?: number;
  /** ISO date `YYYY-MM-DD` the balance was true on. */
  asOf: string;
}

/** The contents of `<dataDir>/manual.json`. */
export interface ManualEntry {
  version: typeof MANUAL_VERSION;
  accounts: ManualAccount[];
  paySchedule?: PaySchedule;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** True for a real calendar date written `YYYY-MM-DD`; `2026-02-31` and `2026-13-01` are rejected. Never throws. */
export function isIsoDate(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC maps years 0-99 to 1900-1999; setUTCFullYear restores the literal year.
  parsed.setUTCFullYear(y);
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function isManualAccount(x: unknown): x is ManualAccount {
  if (!isRecord(x)) return false;
  if (typeof x.id !== 'string' || x.id === '') return false;
  if (typeof x.name !== 'string' || x.name === '') return false;
  if (!KINDS.includes(x.kind as AccountKind)) return false;
  if (!isFiniteNumber(x.balance)) return false;
  if (x.apr !== undefined && !isFiniteNumber(x.apr)) return false;
  return isIsoDate(x.asOf);
}

function isPaySchedule(x: unknown): x is PaySchedule {
  return (
    isRecord(x) &&
    x.cadence === 'biweekly' &&
    isIsoDate(x.anchorDate) &&
    isFiniteNumber(x.expectedAmount) &&
    x.expectedAmount > 0
  );
}

/** Runtime guard for `manual.json`: version, every account's fields, unique ids, optional pay schedule. */
export function isManualEntry(x: unknown): x is ManualEntry {
  if (!isRecord(x)) return false;
  if (x.version !== MANUAL_VERSION) return false;
  if (!Array.isArray(x.accounts) || !x.accounts.every(isManualAccount)) return false;
  const ids = x.accounts.map((a: ManualAccount) => a.id);
  if (new Set(ids).size !== ids.length) return false;
  return x.paySchedule === undefined || isPaySchedule(x.paySchedule);
}
