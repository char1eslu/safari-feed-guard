# Contributing

Thanks for helping fight X spam bots. This is a public-good project — please
read [GOVERNANCE.md](./GOVERNANCE.md) first; contributions that weaken the
governance red-lines (auto-publication, scope, appeals, privacy) won't be
accepted regardless of code quality.

## Ways to contribute

- **Code**: extension, classifier, central service, sync job.
- **Selector maintenance**: X's DOM changes; passive selectors need upkeep.
- **False-positive appeals**: if a legit account is listed, open an appeal
  (issue template) — this is a first-class contribution.
- **Detection quality**: spam-pattern fixtures, prompt/heuristic tuning.

## Dev setup

```bash
cp .env.example .env      # LLM_* (your own OpenAI-compatible endpoint)
pnpm install
pnpm test                 # node:test
pnpm typecheck            # tsc strict
pnpm lint                 # biome
pnpm serve                # local service
pnpm classify <file.json> # one-off classify (see fixtures/)
```

Stack: TypeScript (strict) + Zod + pnpm + Biome + `node --test`. The
extension is plain MV3 JS (no build step) on purpose.

## Pull requests

- Branch `feat/…` `fix/…` `chore/…` `docs/…`; Conventional Commits.
- `pnpm typecheck && pnpm test && pnpm lint` must pass.
- Never commit secrets. `.env` is gitignored; verify with `git status`.
- Keep the extension strictly **passive** (no scraping, no automation of X,
  no action on the user's account without an explicit user gesture).
- Describe behavior changes and how you tested them.

## Reporting issues

- Bugs / selectors: bug issue template.
- A wrongly-listed account: **appeal** template (do not debate scope in code).
- Security / privacy: see [SECURITY.md](./SECURITY.md) — do not open a public
  issue.
