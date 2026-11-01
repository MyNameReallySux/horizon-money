import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { resolveDataDir } from './resolveDataDir';

const FIXTURE_PATH = join(process.cwd(), 'src', 'fixtures', 'demo.snapshot.json');

type Next = () => void;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when a Host header names a loopback host, ignoring any port. A missing header is
 * rejected.
 */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':', 1)[0] ?? '';
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * Serves `GET /snapshot.json` from the resolved data dir in dev and preview, falling back to
 * the synthetic fixture. The file is read per request and never copied into `dist`, so a
 * production build contains no personal data.
 */
export function snapshotPlugin(): Plugin {
  const { dir, via } = resolveDataDir({
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    exists: existsSync,
  });
  const dataFile = join(dir, 'snapshot.json');
  let logged = false;

  const logOnce = () => {
    if (logged) return;
    logged = true;
    const using = existsSync(dataFile)
      ? `data dir ${dir} (via ${via})`
      : `bundled demo fixture (no snapshot.json in ${dir})`;
    console.log(`[horizon-money] snapshot source: ${using}`);
  };

  const handler = (req: IncomingMessage, res: ServerResponse, next: Next) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/snapshot.json') return next();
    // Registered before Vite's allowedHosts check, so without this a DNS-rebinding page could
    // read the real snapshot. Not a post hook: Vite's SPA fallback rewrites the URL to
    // /index.html before a post middleware would see it.
    if (!isLoopbackHost(req.headers.host)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const useData = existsSync(dataFile);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Horizon-Source', useData ? 'data' : 'fixture');
    res.end(readFileSync(useData ? dataFile : FIXTURE_PATH));
  };

  return {
    name: 'horizon-money-snapshot',
    configureServer(server) {
      logOnce();
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      logOnce();
      server.middlewares.use(handler);
    },
  };
}
