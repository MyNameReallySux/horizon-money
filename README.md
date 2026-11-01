# horizon-money

Visual personal-finance dashboard: weekly, monthly and yearly goals, debt payoff and light
forecasting from a local [Monarch Money](https://www.monarch.com) snapshot.

## Status

Early development (`0.x`). Expect breaking changes.

## Your data

This repository is public. **Your financial data never goes into it.** The app reads a
snapshot from a data directory you choose:

| Option | How | When |
|---|---|---|
| Env var | set `HORIZON_DATA_DIR` to any folder | you keep data elsewhere |
| In-repo | create `./private/` (gitignored) | you want it next to the code |
| Default | `~/.horizon-money/` | nothing else is set |

Resolution order: `HORIZON_DATA_DIR`, then `./private/` if it exists, then
`~/.horizon-money/`. Without a snapshot the app renders synthetic fixture data.

Two guards keep data out of git:

1. `.gitignore` ignores `private/`, `data/`, snapshots, and statement/paystub file types.
2. `scripts/check-leaks.mjs` runs as a pre-commit hook and in CI, and fails on those paths
   or on content that looks like real account data (masked account numbers, real entity ids).

## Getting started

```bash
# install dependencies
pnpm install

# run the dev server / app
pnpm dev

# run the checks CI runs
pnpm check:leaks
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). By participating you agree to the
[Code of Conduct](./CODE_OF_CONDUCT.md).

Pull requests run a draft-gated CI workflow — open as a draft while iterating, then
mark **Ready for review** to trigger CI. CodeRabbit and Copilot review PRs automatically.

## License

Released under the [MIT License](./LICENSE).
