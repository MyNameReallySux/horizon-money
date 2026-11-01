import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from './resolveDataDir';

const cwd = resolve('/work/app');
const home = resolve('/home/someone');

describe('resolveDataDir', () => {
  it('uses an absolute HORIZON_DATA_DIR', () => {
    const abs = resolve('/elsewhere/data');
    const result = resolveDataDir({ env: { HORIZON_DATA_DIR: abs }, cwd, home, exists: () => true });
    expect(result).toEqual({ dir: abs, via: 'env' });
  });

  it('resolves a relative HORIZON_DATA_DIR against cwd', () => {
    const result = resolveDataDir({ env: { HORIZON_DATA_DIR: 'mydata' }, cwd, home, exists: () => false });
    expect(result).toEqual({ dir: join(cwd, 'mydata'), via: 'env' });
  });

  it('uses ./private when it exists and no env is set', () => {
    const result = resolveDataDir({ env: {}, cwd, home, exists: (p) => p === join(cwd, 'private') });
    expect(result).toEqual({ dir: join(cwd, 'private'), via: 'private' });
  });

  it('falls back to ~/.horizon-money', () => {
    const result = resolveDataDir({ env: {}, cwd, home, exists: () => false });
    expect(result).toEqual({ dir: join(home, '.horizon-money'), via: 'home' });
  });
});
