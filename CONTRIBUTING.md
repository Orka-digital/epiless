# Contributing to epi-less

Start with the [README](README.md) and [implementation checklist](docs/IMPLEMENTATION.md). Small pull requests with a clear user-visible problem are easiest to review. Discuss substantial changes to capture permissions, audit conclusions, publication or the feed protocol before expanding them.

1. Install the pinned Node and pnpm versions, run `pnpm install --frozen-lockfile` and `pnpm setup:local`.
2. Create a branch for one coherent change. Use synthetic reports and your own test sites.
3. Add meaningful tests for changed behavior. A detector change needs numeric fixtures; a sharing change needs access and revocation checks; a UI change needs a browser check.
4. Run `pnpm check`, `pnpm test` and `pnpm build`. For UI/extension changes, install Chromium with `pnpm exec playwright install chromium` and run `pnpm test:e2e`.
5. Describe the problem, resulting behavior, validation and remaining limitations in the pull request.

Do not turn an inconclusive result into a pass, hide missing coverage, upload captured video by default, broaden autonomous actions into transactions or put network requests on the future blocker's matching path. Keep production secrets and personal audit content out of Git, tests, issues and CI artifacts. Product pages must remain readable without motion; do not introduce flashing demos.

## Documented module boundaries

Give each module one clear responsibility. Split files when they mix state ownership, transport validation, policy and rendering; a line count alone is not a reason to create another wrapper. Aim for implementation modules of roughly 300–400 lines when those responsibilities can stand independently. Large existing modules can be improved in focused follow-up PRs; frozen evidence and generated sources are not refactoring targets.

Use JSDoc for exported functions, factories and non-obvious contracts. Explain the purpose, meaningful parameters, return behavior, side effects and failure conditions. Document safety and privacy limits near the code that enforces them. TypeScript declarations own the types; do not duplicate them in `{Type}` tags. JavaScript helpers still need explicit JSDoc types under `checkJs`. Avoid comments that merely repeat a function name.

A structural refactor must retain behavior and existing regression coverage. Internal modules should import their direct dependencies, not their own entrypoint; avoid circular dependencies and expanding a package's public API just to share a helper. Update [the codebase map](docs/CODEBASE.md) when responsibilities move.

Use `pnpm format` to format changed code, then inspect the diff. The original product specification is excluded from automatic formatting. Pin dependency and Action changes and explain their purpose. Fork pull requests receive no deployment, signing, mail or account secrets.

Maintainers use squash merges into `main` after the required checks and independent review. Do not ask contributors to sign an additional contributor agreement. By submitting a contribution, you agree to license it under the repository's existing MIT terms and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
