# Data pipeline

How a Monarch Money snapshot gets from Monarch to the dashboard, without any of it entering git.

```
Claude session --MCP--> <dataDir>/raw/*.json --+
                                               +--> pnpm snapshot:assemble --> <dataDir>/snapshot.json
you ----------------------> <dataDir>/manual.json --+
```

`<dataDir>` is resolved as described in the README: `HORIZON_DATA_DIR`, then `./private/`,
then `~/.horizon-money/`.

Optionally, `<dataDir>/paystubs/index.json` (from `pnpm paystubs:download`, see
[paystubs.md](paystubs.md)) is read too: when present, `paychecks` is reconciled against pay
stubs instead of being built from deposits alone.

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

## targets.json

Optional. The weekly, monthly and yearly targets of a personal plan, loaded into `goals` after
the Monarch goals. See [targets.example.json](./targets.example.json). A missing file is not a
warning.

- `version` (must be 1; any other version rejects the whole file with a warning), optional
  `effective: { from, to }` (ISO dates), and `targets[]`.
- Target: `id` (unique), `name`, `period` (`week`, `month` or `year`), `metric`, `target`
  (positive), `direction` (`max` is a cap, `min` is a floor), optional `stretch` (number) and
  `by` (ISO date, for yearly goals).
- `metric` keys the UI knows: `spending` (total), `category:<name>` and `group:<name>` (spend
  caps), `debt-paydown` (dollars to debts), `card-balance` (max total card balance), `interest`
  (max monthly interest), `emergency-fund` (savings target), `paychecks-missed` (max count).
- An invalid entry is dropped with one warning (by position, never its content); the rest load.
  Within the file the first of two entries sharing an id wins. A target whose id matches a
  Monarch goal replaces that goal (the file is the hand-written plan), with a warning.
- Like `manual.json`, the real file stays in the data dir; `.gitignore` and the leak guard block it.

## Assemble

```bash
pnpm snapshot:assemble
```

Reads `raw/`, `manual.json` and `targets.json`, validates the result with `isSnapshot`, and writes
`<dataDir>/snapshot.json` atomically (temp file, then rename). It prints one summary line of
counts, plus warnings, and never prints names or amounts. Exit code 1 means nothing was written.

`pnpm dev` serves the result; the app falls back to the synthetic fixture when there is none.

## Refresh

In a Claude Code session in this repo, ask to "refresh my dashboard data" or run
`/refresh-snapshot`. The skill only calls Monarch read tools.

## Monarch write safety

Refresh is read-only. Monarch writes stay possible in this repo, but `.claude/settings.json`
lists every `mcp__monarch__` write tool under `permissions.ask`, so each one prompts every time,
even after "always allow". JSON allows no comments, so the reasoning lives here. Keep that list
in step with the server's tools when Monarch adds or renames one.
