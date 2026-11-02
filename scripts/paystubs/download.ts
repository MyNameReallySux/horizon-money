/**
 * Downloads pay stub PDFs from the Oasis employee portal into `<dataDir>/paystubs/`.
 *
 * Run with `pnpm paystubs:download` (see docs/paystubs.md). Login and MFA happen by hand in the
 * browser window this opens; credentials are never automated. Output is counts only: the data
 * dir holds personal data and this log may end up in a chat transcript.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { PAYSTUB_INDEX_VERSION, isPaystubIndex, mergeIndex, stubFileName, type PaystubEntry } from '../../src/paystubs/index.ts';
import { decodePdf, parseStubs, parseYears } from '../../src/paystubs/payload.ts';
import { resolveDataDir } from '../../src/server/resolveDataDir.ts';

const ORIGIN = 'https://portal.oasisassistant.com';
const PAGE_PATH = '/employee/compensation/payStubs';
const INFO_PATH = '/SCORPEO/subroutine/NsEePayGetPayStubInfo';
const REPORT_PATH = '/NGMS/Reporting/eePayStub/getPayStubReport';
const LOGIN_WAIT_MS = 10 * 60_000;
const POLL_MS = 1_000;
const PAUSE_MS = 750;

const USAGE = `Usage: pnpm paystubs:download [options]

Options:
  --year <yyyy>  Download one year; repeat for several. Default: the current year.
  --all          Download every year the portal lists.
  --force        Download PDFs that already exist.
  --dry-run      List stubs only; fetch no PDFs and write no files.
  --help         Show this message.

Env: HORIZON_DATA_DIR picks the data dir; HORIZON_CHROME_PATH launches that Chrome binary
instead of the installed one.`;

interface Session {
  token: string;
  employeeId: string;
  clientId: string;
}

type Capture = Partial<Session>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Finds a string `key` anywhere in a JSON body; the client id sits at a different depth per endpoint. */
function findString(node: unknown, key: string, depth = 0): string | undefined {
  if (depth > 6 || !isRecord(node)) return undefined;
  const direct = node[key];
  if (typeof direct === 'string' && direct !== '') return direct;
  for (const child of Object.values(node)) {
    const found = findString(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Records session identifiers from the portal's own requests; nothing captured is logged or stored. */
function watchRequests(context: BrowserContext, capture: Capture): void {
  context.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).origin !== ORIGIN) return;
    let body: unknown;
    try {
      body = JSON.parse(request.postData() ?? '');
    } catch {
      return;
    }
    if (request.url().includes(INFO_PATH) && isRecord(body) && isRecord(body.JSONIN)) {
      const { sessionToken, employeeId } = body.JSONIN;
      if (typeof sessionToken === 'string' && typeof employeeId === 'string') {
        capture.token = sessionToken;
        capture.employeeId = employeeId;
      }
    }
    capture.clientId ??= findString(body, 'clientId');
  });
}

const isComplete = (c: Capture): c is Session =>
  c.token !== undefined && c.employeeId !== undefined && c.clientId !== undefined;

async function waitForSession(page: Page, capture: Capture): Promise<Session> {
  const started = Date.now();
  const deadline = started + LOGIN_WAIT_MS;
  let announced = false;
  let lastNudge = Date.now();
  while (Date.now() < deadline) {
    if (isComplete(capture)) return capture;
    if (!announced && Date.now() - started > 5_000) {
      console.log('Not logged in yet: log in (including MFA) in the browser window; waiting up to 10 minutes.');
      announced = true;
    }
    const url = new URL(page.url(), ORIGIN);
    if (Date.now() - lastNudge > 20_000 && url.origin === ORIGIN && url.pathname.startsWith('/employee') && !url.pathname.includes('payStubs')) {
      lastNudge = Date.now();
      await page.goto(`${ORIGIN}${PAGE_PATH}`).catch(() => {});
    }
    await sleep(POLL_MS);
  }
  throw new Error('timed out waiting for a logged-in portal session');
}

type PortalReply = { ok: true; json: unknown } | { ok: false; status: number };

/** POSTs from inside the page so cookies and origin match the portal's own calls. */
async function postJson(page: Page, path: string, body: unknown): Promise<PortalReply> {
  // The session token must only ever be sent to the portal, never to wherever the page drifted.
  if (new URL(page.url()).origin !== ORIGIN) return { ok: false, status: 0 };
  return page
    .evaluate(
      async ({ url, body }) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'same-origin',
        });
        if (!res.ok) return { ok: false as const, status: res.status };
        try {
          return { ok: true as const, json: (await res.json()) as unknown };
        } catch {
          return { ok: false as const, status: res.status };
        }
      },
      { url: `${ORIGIN}${path}`, body },
    )
    .catch((): PortalReply => ({ ok: false, status: 0 }));
}

function writeAtomic(target: string, data: string | Uint8Array): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, target);
}

function readIndex(path: string): PaystubEntry[] {
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isPaystubIndex(parsed)) return parsed.stubs;
  } catch {
    // Falls through: the parser's message can quote file content, which must not reach the log.
  }
  console.warn('warning: paystubs/index.json is unreadable; rebuilding it from this run');
  return [];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      year: { type: 'string', multiple: true },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const years = values.year ?? [];
  if (years.some((y) => !/^\d{4}$/.test(y))) throw new Error('--year expects a four-digit year');
  const dryRun = values['dry-run'];

  const { dir, via } = resolveDataDir({ env: process.env, cwd: process.cwd(), home: homedir(), exists: existsSync });
  const stubsDir = join(dir, 'paystubs');
  const indexPath = join(stubsDir, 'index.json');

  const profileDir = join(dir, 'browser', 'oasis');
  // The profile holds portal login cookies. The mode applies on POSIX only; Windows relies on
  // the user-profile ACL to keep other accounts out.
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const chromePath = process.env.HORIZON_CHROME_PATH?.trim();
  const context = await chromium
    .launchPersistentContext(profileDir, {
      ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
      headless: false,
      acceptDownloads: true,
      viewport: null,
    })
    .catch(() => {
      throw new Error('could not launch Chrome; install it or set HORIZON_CHROME_PATH to a Chrome binary');
    });

  const counts = { years: 0, listed: 0, downloaded: 0, skipped: 0, failed: 0 };
  try {
    const capture: Capture = {};
    watchRequests(context, capture);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${ORIGIN}${PAGE_PATH}`).catch(() => {});
    const session = await waitForSession(page, capture);

    let selected = years;
    if (values.all) {
      const reply = await postJson(page, INFO_PATH, {
        JSONIN: { sessionToken: session.token, payStubYears: true, employeeId: session.employeeId },
      });
      if (!reply.ok) throw new Error(`listing years failed (HTTP ${reply.status})`);
      selected = parseYears(reply.json);
    } else if (selected.length === 0) {
      selected = [String(new Date().getFullYear())];
    }

    const incoming: PaystubEntry[] = [];
    let fetched = 0;
    for (const year of [...new Set(selected)]) {
      counts.years++;
      const reply = await postJson(page, INFO_PATH, {
        JSONIN: { sessionToken: session.token, year, payStubInfo: true, employeeId: session.employeeId },
      });
      if (!reply.ok) {
        counts.failed++;
        console.warn(`warning: listing ${year} failed (HTTP ${reply.status})`);
        continue;
      }
      const { stubs, skipped } = parseStubs(reply.json);
      counts.listed += stubs.length;
      counts.failed += skipped;

      for (const stub of stubs) {
        const rel = stubFileName(stub.payDate, stub.voucherNumber);
        const target = join(stubsDir, rel);
        const present = existsSync(target);
        if (present && !values.force) {
          counts.skipped++;
          incoming.push({ ...stub, file: rel });
          continue;
        }
        if (dryRun) {
          incoming.push({ ...stub, file: present ? rel : null });
          continue;
        }
        if (fetched++ > 0) await sleep(PAUSE_MS);
        const report = await postJson(page, REPORT_PATH, {
          sessionToken: session.token,
          batchNumber: '',
          employeeId: session.employeeId,
          voucherNumber: stub.voucherNumber,
          clientId: session.clientId,
        });
        const pdf = report.ok ? decodePdf(report.json) : null;
        if (pdf === null) {
          counts.failed++;
          incoming.push({ ...stub, file: present ? rel : null });
          continue;
        }
        try {
          writeAtomic(target, pdf);
        } catch {
          counts.failed++;
          incoming.push({ ...stub, file: present ? rel : null });
          continue;
        }
        counts.downloaded++;
        incoming.push({ ...stub, file: rel });
      }
    }

    if (!dryRun && incoming.length > 0) {
      // A merge keeps a prior file link, which is stale if the PDF was deleted since.
      const stubs = mergeIndex(readIndex(indexPath), incoming).map((s) =>
        s.file !== null && !existsSync(join(stubsDir, s.file)) ? { ...s, file: null } : s,
      );
      writeAtomic(
        indexPath,
        `${JSON.stringify({ version: PAYSTUB_INDEX_VERSION, updatedAt: new Date().toISOString(), stubs }, null, 2)}\n`,
      );
    }
  } finally {
    await context.close();
  }

  console.log(
    `paystubs ${dryRun ? 'listed' : 'synced'} (data dir via ${via}): ${counts.years} years, ${counts.listed} listed, ` +
      `${counts.downloaded} downloaded, ${counts.skipped} skipped, ${counts.failed} failed`,
  );
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`paystubs:download failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
