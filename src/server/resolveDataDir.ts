import { isAbsolute, join, resolve } from 'node:path';

export type DataDirVia = 'env' | 'private' | 'home';

export interface ResolveDataDirInput {
  env: Record<string, string | undefined>;
  cwd: string;
  home: string;
  exists: (path: string) => boolean;
}

/**
 * Picks the directory holding `snapshot.json`: `HORIZON_DATA_DIR` (relative values resolve
 * against `cwd`), then `<cwd>/private` if it exists, then `<home>/.horizon-money`.
 * Pure so tests can inject the environment; the home fallback is not checked for existence.
 */
export function resolveDataDir({ env, cwd, home, exists }: ResolveDataDirInput): {
  dir: string;
  via: DataDirVia;
} {
  const fromEnv = env.HORIZON_DATA_DIR?.trim();
  if (fromEnv) {
    return { dir: isAbsolute(fromEnv) ? resolve(fromEnv) : resolve(cwd, fromEnv), via: 'env' };
  }
  const privateDir = join(cwd, 'private');
  if (exists(privateDir)) return { dir: privateDir, via: 'private' };
  return { dir: join(home, '.horizon-money'), via: 'home' };
}
