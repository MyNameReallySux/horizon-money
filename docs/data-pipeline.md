# Data pipeline

How a Monarch Money snapshot gets from Monarch to the dashboard, without any of it entering git.

```
Claude session --MCP--> <dataDir>/raw/*.json --+
                                               +--> pnpm snapshot:assemble --> <dataDir>/snapshot.json
you ----------------------> <dataDir>/manual.json --+
```

`<dataDir>` is resolved as described in the README: `HORIZON_DATA_DIR`, then `./private/`,
then `~/.horizon-money/`.

## raw/

The Monarch Money MCP server is only reachable from a Claude Code session (OAuth), so the
fetch step is a project skill, `refresh-snapshot` (`.claude/skills/refresh-snapshot/SKILL.md`).
It calls the MCP read tools and saves each response verbatim into `<dataDir>/raw/`:

| File | MCP tool | Becomes |
|---|---|---|
| `accounts.json` | GetAccounts | `accounts`, `coverage` (required) |
| `cashflow-monthly.json` | GetCashFlow by month and category group | `cashflowMonthly` |
| `spending-by-category.json` | GetCashFlow by month and category | `spendingByCategory` |
| `categories.json` | GetCategories | group names and expense filtering for spending |
| `recurring.json` | GetRecurring | `recurring` |
| `goals.json` | GetGoals | `goals` |
| `paychecks.json` | GetTransactions, Paychecks category | `paychecks` (needs a `paySchedule`) |

The MCP wraps payloads as `{"result": "<JSON string>"}`; the assembler accepts that form and
the already-unwrapped one. Every file except `accounts.json` is optional: a missing one leaves
its section empty and prints a warning.

## manual.json

Accounts Monarch cannot sync (a restricted institution, a store card) and the pay schedule live
in `<dataDir>/manual.json`. See [manual.example.json](./manual.example.json).

- `accounts[]`: `id`, `name`, `kind`, `balance`, optional `apr` (a percent, 19.99 means 19.99%),
  and `asOf` (the date the balance was true). Liabilities are negative.
- `paySchedule`: `{ "cadence": "biweekly", "anchorDate": "YYYY-MM-DD", "expectedAmount": 3200 }`.
  `anchorDate` is any known pay date; expected paychecks fall every 14 days from it.
- A manual account id must not equal a Monarch account id; the assembler refuses to run if it does.

## Assemble

```bash
pnpm snapshot:assemble
```

Reads `raw/` and `manual.json`, validates the result with `isSnapshot`, and writes
`<dataDir>/snapshot.json` atomically (temp file, then rename). It prints one summary line of
counts, plus warnings, and never prints names or amounts. Exit code 1 means nothing was written.

`pnpm dev` serves the result; the app falls back to the synthetic fixture when there is none.

## Refresh

In a Claude Code session in this repo, ask to "refresh my dashboard data" or run
`/refresh-snapshot`. The skill only calls Monarch read tools.
