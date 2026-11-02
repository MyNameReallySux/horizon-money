#!/usr/bin/env node
/**
 * Leak guard: refuses commits (or CI runs) that would publish personal financial data.
 *
 * Usage:
 *   node scripts/check-leaks.mjs --staged   # pre-commit: files staged for commit
 *   node scripts/check-leaks.mjs            # CI: every tracked file
 *
 * The .gitignore is the first line of defence; this exists because a gitignore can be
 * bypassed (`git add -f`, a renamed folder, a fixture copied from real data).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const staged = process.argv.includes('--staged');
const git = (args) => execFileSync('git', args, { encoding: 'utf8' });
const files = (staged
  ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  : git(['ls-files'])
).split('\n').filter(Boolean);

const blockedPaths = [
  { re: /^(private|data)\//, why: 'personal data folder' },
  { re: /\.(pdf|csv|ofx|qfx)$/i, why: 'statement/paystub file type' },
  { re: /(^|\/)\.env(\.|$)(?!example)/, why: 'env file' },
  { re: /(^|\/)snapshot\.json$/, why: 'live snapshot file' },
  { re: /(^|\/)raw\//, why: 'raw monarch responses', allow: /^src\/fixtures\/raw\// },
  { re: /(^|\/)manual\.json$/, why: 'live manual entry file' },
  { re: /(^|\/)targets[^/]*\.json$/i, why: 'live targets plan file', allow: /^docs\/targets\.example\.json$/ },
  { re: /(^|\/)paystubs\//, why: 'downloaded pay stubs', allow: /^(src\/(fixtures\/)?|scripts\/)paystubs\// },
  { re: /(^|\/)paystubs\/index\.json$/, why: 'pay stub index' },
  { re: /(^|\/)browser\//, why: 'browser profile holding a portal session' },
  { re: /\.snapshot\.json$/, why: 'snapshot outside src/fixtures/', allow: /^src\/fixtures\// },
];

// Content patterns that real Monarch exports carry and synthetic fixtures must not.
const blockedContent = [
  { re: /\(\.\.\.\d{4}\)/, why: 'masked account suffix like (...1234)' },
  { re: /\*{4,}\d{4}/, why: 'masked account number like ****1234' },
  { re: /"id"\s*:\s*"\d{15,}"/, why: 'real Monarch entity id' },
  { re: /"(merchant|account)_id"\s*:\s*"\d{15,}"/, why: 'real Monarch entity id' },
];

const textLike = /\.(json|ts|tsx|js|mjs|cjs|md|txt|yml|yaml|html|css)$/i;
const selfPath = 'scripts/check-leaks.mjs';
const problems = [];

for (const file of files) {
  for (const rule of blockedPaths) {
    if (rule.re.test(file) && !(rule.allow && rule.allow.test(file))) {
      problems.push(`${file}: ${rule.why}`);
    }
  }
  if (file === selfPath || !textLike.test(file) || !existsSync(file)) continue;
  const body = staged ? git(['show', `:${file}`]) : readFileSync(file, 'utf8');
  for (const rule of blockedContent) {
    if (rule.re.test(body)) problems.push(`${file}: ${rule.why}`);
  }
}

if (problems.length) {
  console.error('Leak guard blocked this change:\n  ' + problems.join('\n  '));
  console.error('\nReal data belongs in private/ or HORIZON_DATA_DIR, which git ignores.');
  process.exit(1);
}
console.log(`Leak guard: ${files.length} file(s) clean.`);
