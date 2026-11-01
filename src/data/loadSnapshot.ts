import fixture from '../fixtures/demo.snapshot.json';
import { isSnapshot, type Snapshot } from './contract';

export interface LoadedSnapshot {
  snapshot: Snapshot;
  /** `fixture` when the bundled demo data was used, `data` when the server supplied a real snapshot. */
  source: 'fixture' | 'data';
}

/**
 * Fetches `/snapshot.json`, falling back to the bundled fixture on any network, parse or
 * validation failure so the app always renders something.
 */
export async function loadSnapshot(): Promise<LoadedSnapshot> {
  try {
    const res = await fetch('/snapshot.json');
    if (res.ok) {
      const body: unknown = await res.json();
      if (isSnapshot(body)) {
        const served = res.headers.get('X-Horizon-Source');
        return { snapshot: body, source: served === 'data' ? 'data' : 'fixture' };
      }
    }
  } catch {
    // Fall through to the bundled fixture.
  }
  return { snapshot: fixture as Snapshot, source: 'fixture' };
}
