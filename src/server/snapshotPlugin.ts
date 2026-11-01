import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { resolveDataDir } from './resolveDataDir';

const FIXTURE_PATH = join(process.cwd(), 'src', 'fixtures', 'demo.snapshot.json');

type Next = () => void;

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
