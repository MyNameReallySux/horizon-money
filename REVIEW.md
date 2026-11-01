# Review process

How a change gets reviewed in `horizon-money`. This file exists to keep the gate consistent
rather than depending on who is looking and how tired they are.

## Before review: what the author owes

A PR is not ready to look at until all of these are true. They are cheap, and a
reviewer who has to point them out is spending attention on the wrong thing.

```bash
cd C:\Users\chris\projects\me\horizon-money
pnpm install --frozen-lockfile
pnpm check:leaks
pnpm lint
pnpm typecheck
ccfg run-slot run --kind test --wait 600 -- pnpm test
ccfg run-slot run --kind build --wait 600 -- pnpm build
```

Additionally, per change type:

| Change touches | Also required |
| --- | --- |
| A database schema | Migration generated, applied to a **fresh** database, resulting schema inspected — not assumed |
| A user-facing component | The component viewed in a browser in **both themes**, not only typechecked |
| A route or form | Exercised in the running app, not only typechecked |
| A third-party API | Response shape verified against the live API before the mapping is written |

> Replace these rows with the ones this repo actually has. The table earns its keep only
> when each row names a check that has already caught something here.

**Verify by state, not by exit code.** A command that exits 0 has proved that it ran, not
that it worked. A migration that generates is not a migration that applies; a build that
succeeds is not a page that renders; an API call that returns 201 is not a request that
landed.

## The review itself

### Scope

Review **the diff**. Open files in the diff for surrounding context freely, but do not
silently rely on files outside it — if a judgement needs them, say so and name the file and
the question. A flagged unknown is worth more than a confident wrong call.

### What to look for, in priority order

1. **Security.** Secrets in code, tests, fixtures or URLs. Server-only code reachable from
   the browser. Untrusted input reaching a query, a path, or an upstream request. Untrusted
   upstream data trusted structurally.
2. **Hidden bugs.** Logic wrong in a way the tests would not catch. Nullability, float
   behaviour, error swallowing, retry and control flow, SQL semantics, cascade and index
   behaviour.
3. **Correctness against stated intent.** The PR body claims something. Check the code
   actually does it, and that the tests prove it rather than passing vacuously.
4. **Conventions.** See below. Real, but never ahead of the three above.

### Severity ladder

Use these words exactly, so "I have a comment" and "do not merge this" are never confused.

| Severity | Means | Blocks merge |
| --- | --- | --- |
| **blocker** | Wrong, unsafe, or loses data. A concrete failure scenario exists | Yes |
| **should-fix** | Real problem, no data at risk. Merging leaves a known defect | Author's call, stated explicitly |
| **nit** | Style, naming, phrasing. Take it or leave it | No |

Every finding states a **concrete failure scenario** — inputs or state, and the wrong result
that follows. "This could be cleaner" is not a finding. If a scenario cannot be written, it
is a nit at most.

## Conventions checked during review

### Comments

A comment must say something the code cannot. If it restates the code, labels a region, or
narrates the edit, it is deleted.

Never: section dividers or banners, restatements of the next line, changelog or PR chatter,
commented-out code, bare ticket ids.

Always: JSDoc on exported symbols; the **why** — a constraint, an invariant, a gotcha, or a
reason the obvious approach fails. Cite a ticket alongside such an explanation, never
instead of one.

Match the surrounding file's comment density and idiom rather than importing a new style
into it.

### Code

- The formatter is the source of truth for style, so run it rather than arguing in review.
- Conventional Commits for messages, and the body explains **why**, including anything
  discovered the hard way that would otherwise be rediscovered.
- Branches follow `[agent-|claude-|revert-]<type>/[<tickets>/]<name>`, lowercase and
  hyphenated. Both bracketed parts are optional: the prefix marks a branch an agent or a
  revert created, and a hand-made branch has none. Including the ticket is what makes the
  tracker link the PR by itself, so prefer it — but its absence is not a finding.

### Locked domain rules

These are decisions, not preferences. A diff that contradicts one is wrong even if it works,
and the fix is either to follow the rule or to reverse it explicitly in `CLAUDE.md` under
**Conventions & gotchas** first.

> **Seed this section as the repo makes its first irreversible decisions.** It is the part a
> review agent cannot infer — nothing about a diff that breaks one of these looks wrong
> locally. Each entry is one line of rule plus a pointer to the full reasoning. Examples of
> the shape, from another repo:
>
> - **Grams is the canonical stored unit.** Rounding never happens on the way into storage.
> - **Archive, never delete.** Anything referenced by history carries `archivedAt`.
> - **Secrets via the dynamic private env module**, never the static one, and never in a URL.

## Using a review agent

Reviews may be delegated to a sub-agent. One agent per PR, scoped to that PR's diff;
read-only, so no worktree isolation is needed.

The prompt must carry: the exact `git diff` command for that PR, the scope discipline above,
the priority order, the severity ladder, the conventions, and the locked domain rules. An
agent that is not told the domain rules will approve a diff that quietly breaks one, because
nothing about it looks wrong locally.

Agent findings are **input, not a verdict**. They are checked before being acted on — a
confidently wrong finding costs more than a missed one, and reviewers that are eager to
please will produce both.

Check the **reasoning**, not just the conclusion. A wrong conclusion arrives alongside
genuinely excellent work, which is exactly what makes it easy to wave through. A finding
that contradicts something you have already observed gets re-tested, not deferred to.

## Recurring findings

Patterns that have already cost real defects. Check for them explicitly — each one looks
fine locally, which is exactly why they survive a casual read.

**Add to this list as the repo earns entries.** The ones below are portable; they have shown
up in more than one codebase.

### An invariant asserted in a comment is not an invariant

A JSDoc says a value "must be greater than zero", or that a group of columns is "present as a
set" — and nothing enforces any of it. The comment then reads as a guarantee to the next
person, who relies on it.

Either push the rule into the code or the database where it can be enforced, or soften the
comment so it does not promise something the code does not deliver. Asserting and not
enforcing is the worst of the three options, because it buys false confidence.

### A guard that lives in the caller expires the day a second caller appears

A validated value passed into an exported function is validated by convention, not by
contract — the parameter name says `normalizedUpc`, and nothing checks it is normalized. It
holds until someone adds a second call site that skips the validating wrapper.

Either keep the wrapper as the only public entry point, or re-assert the invariant at the top
of each exported function so the guard travels with it.

### `in` is not `Object.hasOwn`

`in` walks the prototype chain, so `'toString' in SOME_LOOKUP` is true and the lookup then
yields a function. Arithmetic on it produces `NaN`, which flows on silently. TypeScript does
not save you: a value arriving from a form field or a URL is whatever union you asserted it to
be, and only at compile time.

Use `Object.hasOwn` for any lookup keyed by a value that could come from outside the program.

### Guard the result, not only the inputs

Two finite numbers multiply to `Infinity` once they overflow. Validating inputs and returning
the product unexamined is what turns "never silently wrong" into an aspiration. Check the
value being returned.

### Compare normalised to normalised

Equality against a value an upstream echoed back couples correctness to that upstream's
formatting, which is not under our control and not asserted anywhere. Normalise both sides
before comparing.

### Assertions that cannot fail

`expect(toGrams(1, 'ounce')).toBeCloseTo(28.349523125)` is `1 × x === x`. A test that cannot
fail is worse than no test, because it occupies the space where a real one would go. When
writing an assertion, ask what change to the source would turn it red; if the answer is
"none", delete or strengthen it.

The same applies to matching errors. `toThrow(/UNIQUE/)` passes when an entirely unrelated
constraint rejects the row. Match the specific guard.

## Honesty about what was not verified

A reviewer that cannot run something says so, in the report, naming the limitation. A review
that reads generated SQL is worth having; a review that _implies_ it executed tests it could
not execute is worth less than none, because it launders a guess into a verification.

The same applies to the author. "Tests pass" means they were run, on this machine, just now.

## After review

- Findings are answered individually: fixed, or declined with a reason. Silence is not a
  response.
- Anything deferred becomes a ticket, not a comment thread nobody reads again.
- Anything learned the hard way — an upstream quirk, a tool that lies about success — goes in
  the code as a comment and in `CLAUDE.md`. The test of a good note is whether it stops
  the next person rediscovering the same thing.
