---
name: refresh-snapshot
description: Refresh the horizon-money dashboard data from Monarch Money. Use when the user says "refresh my dashboard data", "update the snapshot", or runs /refresh-snapshot.
---

# refresh-snapshot

Pull current data from the Monarch Money MCP into the user's private data directory, then
assemble `snapshot.json` from it.

## Mandate

This skill will:

- Read Monarch through the MCP **read** tools only (GetAccounts, GetCashFlow, GetCategories,
  GetRecurring, GetGoals, GetTransactions).
- Write raw responses into `<dataDir>/raw/`, outside the repo.
- Run `pnpm snapshot:assemble` from the repo root.

This skill will not:

- Call any Monarch write tool (create, update, delete, or any tool that changes Monarch data).
- Write anything inside the repo. The repo is public; real financial data never enters git.
- Print balances, account names, merchants or other figures into chat, commits or comments.
  Report counts and the assemble summary line only.

## Steps

1. **Resolve the data directory**, in this order: the `HORIZON_DATA_DIR` environment variable;
   `./private/` in the repo root if it exists; `~/.horizon-money/`. Tell the user which one and
   which rule picked it. Create `<dataDir>/raw/` if needed.

2. **Fetch and save each file below.** Save the MCP response verbatim to `<dataDir>/raw/<file>`
   with the Write tool; do not reformat or trim it. If the harness saved a large result to a
   file instead of returning it inline, copy that file into `raw/` rather than re-typing it.
   Use intent `financial_planning` (or `cash_flow_planning` for GetCashFlow).

   | File | Tool and arguments |
   |---|---|
   | `accounts.json` | `GetAccounts` |
   | `categories.json` | `GetCategories` |
   | `cashflow-monthly.json` | `GetCashFlow`, `base_query` grouped by month and category group, over the last 13 full months |
   | `spending-by-category.json` | `GetCashFlow`, `base_query` grouped by month and category, over the same 13 months |
   | `recurring.json` | `GetRecurring` |
   | `goals.json` | `GetGoals` |
   | `paychecks.json` | `GetTransactions`, see below |

   For the two GetCashFlow calls, read the tool's schema for the exact `base_query` shape:
   a date range from the first day of the month 13 months before the current month through the
   last day of the previous month, grouped by month and then by `category_group` (first call)
   or `category` (second call).

   For `paychecks.json`, call `GetTransactions` with `filters`
   `{"transaction_type":"Credit","categories":["Paychecks"]}`, 100 results at a time, repeating
   with the next page until the response reports `truncated` as false. Concatenate every page's
   `transactions` into one `{"transactions": [...]}` object and save that. If the user has no
   Paychecks category, skip this file; the assembler warns and leaves paychecks empty.

   If a tool fails, keep going with the others and say which file is missing. Only
   `accounts.json` is required.

3. **Assemble.** From the repo root, run:

   ```bash
   pnpm snapshot:assemble
   ```

   Report its summary line and any warnings verbatim (they carry counts only). On failure,
   report the error and stop; do not edit the raw files by hand to get past it.

4. **Remind the user** that restricted accounts and the pay schedule come from
   `<dataDir>/manual.json` (see `docs/data-pipeline.md`), and that `coverage` in the summary
   shows how many institutions Monarch reported as hidden.
