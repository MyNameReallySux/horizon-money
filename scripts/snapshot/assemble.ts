/**
 * Assembles `<dataDir>/snapshot.json` from `<dataDir>/raw/*.json`, `<dataDir>/manual.json` and `<dataDir>/targets.json`.
 *
 * Run with `pnpm snapshot:assemble`. Output is counts only: the data dir holds personal
 * data and this log may end up in a chat transcript.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { isSnapshot } from '../../src/data/contract.ts';
import { buildSnapshot, type RawInputs } from '../../src/pipeline/build.ts';
import { unwrapMcp } from '../../src/pipeline/raw.ts';
import { resolveDataDir } from '../../src/server/resolveDataDir.ts';

function readJson(path: string, unwrap: boolean): unknown {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return unwrap ? unwrapMcp(parsed) : parsed;
  } catch {
    // The parser's message can quote file content, which must not reach the log.
    throw new Error(`${basename(path)} is not valid JSON`);
  }
}

function main(): void {
  const { dir, via } = resolveDataDir({
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    exists: existsSync,
  });
  const rawDir = join(dir, 'raw');
  const raw = (name: string): unknown => {
    const path = join(rawDir, name);
    return existsSync(path) ? readJson(path, true) : undefined;
  };

  const accounts = raw('accounts.json');
  if (accounts === undefined) {
    throw new Error(`raw/accounts.json not found in the data dir (resolved via ${via}); run the refresh-snapshot skill first`);
  }
  const manualPath = join(dir, 'manual.json');
  const targetsPath = join(dir, 'targets.json');
  const paystubsPath = join(dir, 'paystubs', 'index.json');
  const input: RawInputs = {
    accounts,
    cashflowMonthly: raw('cashflow-monthly.json'),
    spendingByCategory: raw('spending-by-category.json'),
    categories: raw('categories.json'),
    recurring: raw('recurring.json'),
    goals: raw('goals.json'),
    paychecks: raw('paychecks.json'),
    manual: existsSync(manualPath) ? readJson(manualPath, false) : undefined,
    targets: existsSync(targetsPath) ? readJson(targetsPath, false) : undefined,
    paystubs: existsSync(paystubsPath) ? readJson(paystubsPath, false) : undefined,
  };

  const { snapshot, warnings } = buildSnapshot(input, { now: new Date() });
  if (!isSnapshot(snapshot)) throw new Error('assembled snapshot failed validation');

  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'snapshot.json');
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(temp, target);

  const manualCount = snapshot.accounts.filter((a) => a.source === 'manual').length;
  console.log(
    `snapshot written (data dir via ${via}): ${snapshot.accounts.length} accounts (${manualCount} manual), ` +
      `${snapshot.cashflowMonthly.length} cashflow months, ${snapshot.spendingByCategory.length} spending rows, ` +
      `${snapshot.recurring.length} recurring, ${snapshot.paychecks.length} paychecks, ${snapshot.goals.length} goals, ` +
      `${snapshot.coverage.hiddenInstitutions.length} hidden institutions, ${warnings.length} warnings`,
  );
  for (const w of warnings) console.warn(`warning: ${w}`);
}

try {
  main();
} catch (err) {
  console.error(`snapshot:assemble failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
