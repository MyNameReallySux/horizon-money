# horizon-money

Visual personal-finance dashboard: weekly, monthly and yearly goals, debt payoff and light
forecasting from a local Monarch Money snapshot.

## Commands

- **Package manager: always `pnpm`** — never `npm`/`yarn` (they corrupt `pnpm-lock.yaml`).
- `pnpm install` — install dependencies.
- `pnpm dev` — Vite dev server; serves `/snapshot.json` from the resolved data dir.
- `pnpm build` — typecheck + production build (no data is bundled).
- `pnpm test` — Vitest; `pnpm test <file>` for one file.
- `pnpm lint` / `pnpm typecheck` — ESLint / `tsc --noEmit`.
- `pnpm check:leaks` — leak guard over every tracked file (CI runs it; the pre-commit hook
  runs it with `--staged`).
- **Run the build and the suite through claude-config's `run-slot` wrapper**, never bare:
  ```bash
  ccfg run-slot run --kind build --wait 600 -- pnpm build
  ccfg run-slot run --kind test --wait 600 -- pnpm test
  ```

## Architecture

Vite + React + TypeScript single-page app with Recharts. The app fetches one JSON snapshot
(`src/data/contract.ts` defines its shape) at runtime. A Vite plugin serves it in dev and
preview from the data directory; with no snapshot present it falls back to the synthetic
fixture in `src/fixtures/`. Snapshots are produced outside the app by a Claude session reading
the Monarch Money MCP.

## Conventions & gotchas

- **This repo is public. Real financial data never enters git** — not in fixtures, tests,
  comments, commit messages, PR bodies or this file. Fixtures are synthetic and must not
  contain masked account numbers or real Monarch ids; the leak guard enforces it.
- Data directory resolution: `HORIZON_DATA_DIR` → `./private/` if it exists →
  `~/.horizon-money/`. Keep `src/data/` free of any path that assumes one machine.
- Personal facts about the owner's finances belong in the owner's notes, not here.

## Git & deployment

- **Base branch:** `main`. Work branches follow `rules/branch-pattern.md`
  (e.g. `agent-feat/PER-599/scaffold-repo`).
- Conventional commits. Draft PR first; CI runs when the PR is marked ready for review.
- No deployment: the app runs locally against local data.

## Tracker workflow

See `.claude/project-map.yaml` for the issue-tracker / Obsidian / GitHub mapping
(Linear team `PER`, project Horizon Money).
