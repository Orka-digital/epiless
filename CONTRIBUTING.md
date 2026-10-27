# Contributing to epi-less

Start with the [README](README.md) and [implementation checklist](docs/IMPLEMENTATION.md). Small pull requests with a clear user-visible problem are easiest to review. Discuss substantial changes to capture permissions, audit conclusions, publication or the feed protocol before expanding them.

1. Install the pinned Node and pnpm versions, run `pnpm install --frozen-lockfile` and `pnpm setup:local`.
2. Create a branch for one coherent change. Use synthetic reports and your own test sites.
3. Add meaningful tests for changed behavior. A detector change needs numeric fixtures; a sharing change needs access and revocation checks; a UI change needs a browser check.
4. Run `pnpm check`, `pnpm test` and `pnpm build`. For UI/extension changes, install Chromium with `pnpm exec playwright install chromium` and run `pnpm test:e2e`.
5. Describe the problem, resulting behavior, validation and remaining limitations in the pull request.

Do not turn an inconclusive result into a pass, hide missing coverage, upload captured video by default, broaden autonomous actions into transactions or put network requests on the future blocker's matching path. Keep production secrets and personal audit content out of Git, tests, issues and CI artifacts. Product pages must remain readable without motion; do not introduce flashing demos.

Use `pnpm format` to format changed code, then inspect the diff. The original product specification is excluded from automatic formatting. Pin dependency and Action changes and explain their purpose. Fork pull requests receive no deployment, signing, mail or account secrets.

Maintainers use squash merges into `main` after the required checks and independent review. Do not ask contributors to sign an additional contributor agreement. By submitting a contribution, you agree to license it under the repository's existing MIT terms and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
