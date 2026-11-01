import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './snapshotPlugin';

describe('isLoopbackHost', () => {
  it.each(['localhost', 'localhost:5173', '127.0.0.1:4173', '[::1]:5173'])(
    'accepts %s',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['evil.example', 'evil.example:5173', undefined])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
