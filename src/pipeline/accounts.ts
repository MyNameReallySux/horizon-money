import type { Account, AccountKind } from '../data/contract.ts';
import { cents, isFiniteNumber, isRecord, recordsAt, type Warn } from './raw.ts';

/** Maps a Monarch account `type` string onto the app's coarser {@link AccountKind}. */
export function mapAccountKind(type: string): AccountKind {
  const t = type.toLowerCase();
  if (t.includes('credit')) return 'credit';
  if (t.includes('mortgage') || t.includes('loan')) return 'loan';
  if (t.includes('checking')) return 'checking';
  if (t.includes('saving')) return 'savings';
  if (/401|403|\bira\b|roth|brokerage|crypto|investment|retirement|\bhsa\b|529/.test(t)) {
    return 'investment';
  }
  if (t.includes('home') || t === 'car' || t.includes('vehicle') || t.includes('real estate')) {
    return 'property';
  }
  return 'other';
}

/**
 * Maps a GetAccounts response. Liabilities are forced negative regardless of how Monarch signs
 * them, to honour the snapshot convention. `interest_rate` is already a percent, as is `Account.apr`.
 */
export function mapAccounts(
  raw: unknown,
  warn: Warn,
): { accounts: Account[]; hiddenInstitutions: string[] } {
  const rows = recordsAt(raw, ['accounts'], 'accounts.json');
  const accounts: Account[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (typeof row.id !== 'string' && typeof row.id !== 'number') {
      skipped++;
      continue;
    }
    if (typeof row.name !== 'string' || !isFiniteNumber(row.balance)) {
      skipped++;
      continue;
    }
    const kind = mapAccountKind(typeof row.type === 'string' ? row.type : '');
    const balance = kind === 'credit' || kind === 'loan' ? -Math.abs(row.balance) : row.balance;
    const account: Account = {
      id: String(row.id),
      name: row.name,
      kind,
      balance: cents(balance),
      source: 'monarch',
    };
    if (isFiniteNumber(row.interest_rate)) account.apr = row.interest_rate;
    accounts.push(account);
  }
  if (skipped > 0) warn(`skipped ${skipped} account(s) with missing id, name or balance`);

  const excluded = isRecord(raw) ? raw.finicity_excluded : undefined;
  const institutions = isRecord(excluded) && Array.isArray(excluded.institutions)
    ? excluded.institutions.filter((i): i is string => typeof i === 'string')
    : [];
  return { accounts, hiddenInstitutions: institutions };
}
