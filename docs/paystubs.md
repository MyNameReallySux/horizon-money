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

## Pay periods

`pnpm paystubs:periods` reads each downloaded PDF's pay period (start and end date) with
`pdfjs-dist`, a dev dependency used by node scripts only, and writes just `periodStart` and
`periodEnd` onto that stub's entry in `index.json`. **Dates are the only thing stored**: the PDF
text is parsed in memory and dropped, and the run prints counts only (`N stubs, K periods found,
M not found`). `pnpm paystubs:download` keeps a stub's known period when it re-lists it.
`src/paystubs/period.ts` documents the accepted label and date shapes.

`pnpm paystubs:periods --probe` is for when periods are not found: it prints, for the first
downloaded PDF only, the text lines that mention period, pay, begin, end, from, to or date. The
output is **masked**: every digit is shown as `#`, and every word outside a small label
vocabulary (pay, period, beginning, ending, from, to, date, check ...) as a run of `x`. It shows
the label layout, never a value, name or amount, and writes nothing.

## Paycheck ledger

With an index present, `paychecks` in the snapshot comes from stubs plus Monarch deposits
(`raw/paychecks.json`). The schedule is `paySchedule` from `manual.json` when set. Otherwise it is
derived as biweekly: the phase is fitted on the most recent run of stubs spaced 10-18 days apart
(at least 3, else all stubs, with a warning), anchored at the slot at or before the latest stub,
expecting the median stub net pay. The 14-day grid projects back over the whole history, so an
older irregular stretch shows up as late, missed or off-cycle.

Stubs and deposits are assigned independently to their nearest slot when within 6 days, closest
first, one per slot. `daysLate` is the deposit (else stub) date minus the slot date; negative is
early. Each slot, through today, gets a `status`:

| Status | Meaning |
|---|---|
| `paid` | A stub and a deposit both assigned to the slot. |
| `stub-only` | A stub but no deposit. Not an error: some deposits land in accounts Monarch cannot see. |
| `deposit-only` | A deposit but no stub. |
| `missed` | Neither. |
| `off-cycle` | A stub or deposit with no slot within 6 days or that lost its slot to a closer one (a bonus, say); a stub and deposit within 3 days of each other share one entry. Its `expectedDate` and `expectedAmount` are its own. |

When stubs carry a `periodEnd`, slots no longer come from the single recent anchor. Period ends
are grouped into runs that share one 14-day grid; a gap between consecutive period ends that is
not a multiple of 14 days (a schedule that moved by a week, say) starts a new run. Each run's
slots are its period ends plus the run's median pay-date offset, so a stub takes the slot of its
own period when its pay date is within 6 days of it, and a shifted schedule shows no spurious
`off-cycle` rows. Stubs without a period, and dates before the first period, keep using the
anchor grid; with no period data at all nothing changes.

`stubNetPay` carries the matched stub's net pay. Without an index nothing changes and these
fields are absent.

## Privacy

- `paystubs/` and `browser/` are git-ignored, and `pnpm check:leaks` blocks them (and every
  `*.pdf`) anywhere except the source folders `src/paystubs/` and `src/fixtures/paystubs/`.
- Fixtures there are synthetic; test PDFs are base64 strings, never files.
- The period script stores dates only; its probe output is masked as described above.
- Tokens are never written to disk. The browser profile does hold the portal's login cookies, so
  keep the data dir private.
