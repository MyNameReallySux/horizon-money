# Pay stubs

`pnpm paystubs:download` saves your pay stub PDFs from the Oasis employee portal into the data
dir and keeps an index of them. When the index exists, `pnpm snapshot:assemble` reconciles the
stubs with the paycheck deposits Monarch sees.

```
portal --(your login, in Chrome)--> <dataDir>/paystubs/<yyyy>/<date>_<voucher>.pdf
                                    <dataDir>/paystubs/index.json --> pnpm snapshot:assemble
```

## First run

```bash
pnpm install
pnpm paystubs:download
```

It opens a Chrome window (the installed Chrome; set `HORIZON_CHROME_PATH` to use another
binary) on the portal's pay stubs page. If you are not logged in, log in there, MFA included.
The script waits up to 10 minutes, then carries on by itself. The login lives in a Chrome
profile under `<dataDir>/browser/oasis/`, so later runs usually skip the login.

The script never types credentials. It reads the session identifiers off the portal's own
requests, uses them for that run only, and neither stores nor prints them.

## Flags

| Flag | Effect |
|---|---|
| none | Current year only. |
| `--year <yyyy>` | That year; repeat for several. |
| `--all` | Every year the portal lists. |
| `--force` | Download PDFs that already exist. |
| `--dry-run` | List stubs; fetch no PDFs and write no files. |

Existing PDFs are skipped. PDFs are fetched one at a time with a short pause, and each is
checked to start with `%PDF` before it is written (temp file, then rename).

## Output

The run prints counts only: years, listed, downloaded, skipped, failed. Amounts, voucher numbers
and names never reach the log. Exit code 1 means at least one stub or year failed.

`<dataDir>/paystubs/index.json` holds one entry per voucher, sorted by pay date:
`payDate`, `netPay`, `checkNumber`, `voucherNumber`, `file` (relative path, or `null` when the PDF
is not on disk) and `source`. Runs merge into it; `src/paystubs/index.ts` has the guard.

## Paycheck ledger

With an index present, `paychecks` in the snapshot comes from stubs plus Monarch deposits
(`raw/paychecks.json`). The schedule is `paySchedule` from `manual.json` when set; otherwise it is
derived as biweekly, anchored on the latest stub, expecting the median stub net pay. Each
expected date (every 14 days, through today) gets a `status`:

| Status | Meaning |
|---|---|
| `paid` | A stub and a deposit each within 3 days of the date. |
| `stub-only` | A stub but no deposit, e.g. not deposited yet or back pay owed. |
| `deposit-only` | A deposit but no stub. |
| `missed` | Neither. |
| `off-cycle` | A stub or deposit that fits no expected date (a bonus, say); a stub and deposit within 3 days of each other share one entry. Its `expectedDate` and `expectedAmount` are its own. |

`stubNetPay` carries the matched stub's net pay. Without an index nothing changes and these
fields are absent.

## Privacy

- `paystubs/` and `browser/` are git-ignored, and `pnpm check:leaks` blocks them (and every
  `*.pdf`) anywhere except the source folders `src/paystubs/` and `src/fixtures/paystubs/`.
- Fixtures there are synthetic; test PDFs are base64 strings, never files.
- Tokens are never written to disk. The browser profile does hold the portal's login cookies, so
  keep the data dir private.
