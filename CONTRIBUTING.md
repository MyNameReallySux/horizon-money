# Contributing to horizon-money

Thanks for your interest in contributing!

## Workflow

1. Fork (external) or branch (collaborator). Branch names follow
   `<type>/<short-description>` (e.g. `feat/add-export`, `fix/null-guard`).
2. Make your change with focused, [Conventional Commits](https://www.conventionalcommits.org/).
3. Run the checks locally before opening a PR:
   ```bash
   pnpm install
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
4. Open your PR **as a draft** while iterating. Mark it **Ready for review** to trigger
   CI — the workflow is gated to skip draft PRs.
5. CodeRabbit and Copilot review automatically; address or reply to their threads.
6. A maintainer merges once CI is green and review is resolved.

What a reviewer will look for — and what you owe them before opening the PR — is written
down in [REVIEW.md](./REVIEW.md). Reading it first is the cheapest way to avoid a round trip.

## Code style

- Match the existing style; the linter/formatter is the source of truth.
- Keep PRs small and single-purpose where possible.

## Reporting bugs / requesting features

Use the issue templates under **Issues → New issue**.
