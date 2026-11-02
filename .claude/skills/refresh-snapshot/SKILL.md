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
  `.claude/settings.json` puts every Monarch write tool on ask, so a write always prompts; keep
  that list in step with the server's tools.
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
   Every call takes `intent`; use `cash_flow_planning` for all of them. Responses arrive
   wrapped as `{"result": "<JSON string>"}`; save them as they arrive, the assembler unwraps.

   | File | Tool and arguments |
   |---|---|
   | `accounts.json` | `GetAccounts` with `intent` only |
   | `categories.json` | `GetCategories` with `intent` only |
   | `cashflow-monthly.json` | `GetCashFlow`, see below, grouped by `category_group` |
   | `spending-by-category.json` | `GetCashFlow`, see below, grouped by `category` |
   | `recurring.json` | `GetRecurring` with `include_liabilities` set to `false` (bills and subscriptions only; credit-card bill streams are not spending) |
   | `goals.json` | `GetGoals` with `intent` only |
   | `paychecks.json` | `GetTransactions`, see below |

   For the two `GetCashFlow` calls, set `start_date` to the first day of the month 13 months
   before the current month and `end_date` to the last day of the previous month (ISO dates,
   inclusive). `base_query` is a JSON **string**:
   `{"group_by_time": "month", "group_by_entity": "category_group"}` for the first file and
   `{"group_by_time": "month", "group_by_entity": "category"}` for the second. Optionally pass
   a `filters` JSON string with `exclude_accounts` (an array of account names) when the user
   has duplicated accounts that double-count; only the user supplies those names.

   For `paychecks.json`, call `GetTransactions` with `start_date` set to January 1 of the previous calendar year (so last
   year's pay stubs can match deposits), the same `end_date`,
   `filters` `{"transaction_type": "Credit", "categories": ["Paychecks"]}` (a JSON string),
   `limit` 100 and `offset` 0. While the response's `truncated` is true, call again with
   `offset` set to its `next_offset`. Concatenate every page's `transactions` into one
   `{"transactions": [...]}` object and save that. If the user has no Paychecks category, skip
   this file; the assembler warns and leaves paychecks empty.

   Responses may carry a `finicity_excluded` block listing hidden institutions; leave it in
   the file, it feeds the snapshot's `coverage`.

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
