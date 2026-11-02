/**
 * Reads each downloaded pay stub PDF's pay period into `<dataDir>/paystubs/index.json`.
 *
 * Run with `pnpm paystubs:periods` (see docs/paystubs.md). Only `periodStart` and `periodEnd` are
 * stored; no other PDF text is kept, and output is counts only because this log may end up in a
 * chat transcript. `--probe` prints a masked sample of the first PDF so the label format can be
 * learned without exposing values.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PAYSTUB_INDEX_VERSION, isPaystubIndex, type PaystubEntry } from '../../src/paystubs/index.ts';
import { linesFromTextItems, type TextItem } from '../../src/paystubs/pdfText.ts';
import { parsePayPeriod } from '../../src/paystubs/period.ts';
import { resolveDataDir } from '../../src/server/resolveDataDir.ts';

const USAGE = `Usage: pnpm paystubs:periods [options]

Options:
  --probe  Print the first PDF's lines that mention period, pay, begin, end, from, to or date (and the
           line after each),
           with every digit shown as # and every word outside a small label vocabulary shown
           as x. Nothing is read into the index in this mode.
  --help   Show this message.

Env: HORIZON_DATA_DIR picks the data dir.`;

const PROBE_LINE = /period|pay|begin|end|from|to|date/i;
const LABEL_WORDS = new Set([
  'pay', 'period', 'beginning', 'begin', 'start', 'starting', 'ending', 'end', 'from', 'to',
  'through', 'thru', 'date', 'check', 'of', 'the', 'for', 'week', 'weekly', 'biweekly',
  'employee', 'id', 'name', 'no', 'start',
]);

/** Text of the PDF, one string per line. */
async function extractLines(path: string): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  const lines: string[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      lines.push(...linesFromTextItems(content.items.filter((item): item is TextItem & typeof item => 'str' in item)));
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

/** Letters the PDF emitted one per item can still arrive spaced out; rejoin them before masking. */
const collapseSplitLetters = (line: string): string =>
  line.replace(/(?<![A-Za-z])[A-Za-z](?: [A-Za-z](?![A-Za-z]))+/g, (run) => run.replace(/ /g, ''));

const mask = (line: string): string =>
  collapseSplitLetters(line)
    .replace(/\d/g, '#')
    .replace(/[A-Za-z]+/g, (w) => (LABEL_WORDS.has(w.toLowerCase()) ? w : 'x'.repeat(w.length)));

function writeAtomic(target: string, data: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, target);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { probe: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const { dir, via } = resolveDataDir({ env: process.env, cwd: process.cwd(), home: homedir(), exists: existsSync });
  const stubsDir = join(dir, 'paystubs');
  const indexPath = join(stubsDir, 'index.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    throw new Error('paystubs/index.json is missing or not valid JSON; run pnpm paystubs:download first');
  }
  if (!isPaystubIndex(parsed)) throw new Error('paystubs/index.json does not match the pay stub index format');

  if (values.probe) {
    const first = parsed.stubs.find((s) => s.file !== null && existsSync(join(stubsDir, s.file)));
    if (!first?.file) throw new Error('no downloaded pay stub PDF to probe');
    const all = await extractLines(join(stubsDir, first.file));
    // The line after a match is shown too: a header row's values sit there, and masking hides them.
    const lines = all.filter((l, i) => PROBE_LINE.test(l) || PROBE_LINE.test(all[i - 1] ?? ''));
    console.log(`masked probe of 1 pdf (digits are #, unknown words are x): ${lines.length} matching lines`);
    for (const line of lines) console.log(mask(line.trim()));
    return;
  }

  let found = 0;
  const stubs: PaystubEntry[] = [];
  for (const entry of parsed.stubs) {
    const next: PaystubEntry = { ...entry };
    if (entry.file !== null && existsSync(join(stubsDir, entry.file))) {
      try {
        const period = parsePayPeriod((await extractLines(join(stubsDir, entry.file))).join('\n'));
        if (period) {
          next.periodStart = period.start;
          next.periodEnd = period.end;
        }
      } catch {
        // A broken PDF counts as not found; the error text can quote file content.
      }
    }
    if (next.periodEnd !== undefined) found++;
    stubs.push(next);
  }

  writeAtomic(
    indexPath,
    `${JSON.stringify({ version: PAYSTUB_INDEX_VERSION, updatedAt: new Date().toISOString(), stubs }, null, 2)}\n`,
  );
  console.log(
    `paystub periods (data dir via ${via}): ${stubs.length} stubs, ${found} periods found, ${stubs.length - found} not found`,
  );
}

main().catch((err: unknown) => {
  console.error(`paystubs:periods failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
