import type { ComponentType } from 'react';
import type { Snapshot } from '../data/contract';
import { Debt } from './Debt';
import { Goals } from './Goals';
import { Overview } from './Overview';

export interface ViewProps {
  snapshot: Snapshot;
}

export interface ViewDefinition {
  /** URL-hash slug and DOM id stem; unique, non-empty, lowercase. */
  id: string;
  /** Tab text. */
  label: string;
  component: ComponentType<ViewProps>;
}

/**
 * Ordered list of app views, one tab each; the first is the default.
 * To add a view: create `src/views/<Name>.tsx` exporting a component that takes
 * `{ snapshot }`, then add one entry here. Nothing else needs to change.
 */
export const views: readonly ViewDefinition[] = [
  { id: 'overview', label: 'Overview', component: Overview },
  { id: 'debt', label: 'Debt', component: Debt },
  { id: 'goals', label: 'Goals', component: Goals },
];

/**
 * Resolves a `location.hash` (with or without the leading `#`) to a view id.
 * An unknown or empty hash falls back to the first view's id.
 */
export function viewIdFromHash(hash: string, list: readonly { id: string }[]): string {
  const id = hash.replace(/^#/, '');
  return list.find((v) => v.id === id)?.id ?? list[0]?.id ?? '';
}
