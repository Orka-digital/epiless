# Validation and evidence map

Use this page to choose a current gate. A historical `pass` file applies to its recorded source fingerprint, fixture, browser and machine. It is not automatic acceptance of today's source or a medical/WCAG safety verdict.

## Current executable gates

Run from the repository root after `pnpm install --frozen-lockfile` with the pinned Node version. Browser checks use isolated Chromium profiles. The normal browser is not a test target.

| Gate                        | Command                                                                                                        | What it establishes                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Code and repo hygiene       | `pnpm check`                                                                                                   | Types, unused code/dependencies, formatting, docs and workflow contracts                                        |
| Unit and backend regression | `pnpm test`                                                                                                    | Engine, policy, storage, publication and operations assertions                                                  |
| Built artifacts             | `pnpm build`                                                                                                   | Website and extension compile; embedded kernel integrity                                                        |
| Web runtime                 | `pnpm test:web-quality`                                                                                        | Production-preview flows, accessibility, responsive layout and budgets                                          |
| Extension browser           | `pnpm --filter @epi-less/chrome-extension test:browser`                                                        | Real extension storage/UI and controlled capture/replay boundaries; not native capture permission/cadence proof |
| Review UI                   | `pnpm test:review-ui`                                                                                          | Review controls against retained evidence                                                                       |
| Dense backend equivalence   | `node packages/analysis-engine/bench/wasm-dense.mjs --output artifacts/wasm-dense-proof.json`                  | Exact JS/WASM state and detection comparisons on the checked cases                                              |
| External numeric references | `pnpm validate:detection --check-baseline` and `pnpm validate:expanded --check-baseline`                       | Current results against frozen reference selections                                                             |
| Spatial/encoded media       | `pnpm validate:spatial-media --check-baseline`                                                                 | Original masks and lossless media regression; requires ffmpeg                                                   |
| Alternating regression      | `node --import tsx scripts/validate-alternating-regression.mjs --output artifacts/alternating-regression.json` | Frozen alternating-corpus regression                                                                            |

[CI](../.github/workflows/ci.yml) is the executable list of required automated gates, including reference-verifier tests and encoded browser preflight. [Security CI](../.github/workflows/security.yml) separately checks dependencies and publication/update boundaries. Local success does not establish that those workflows or branch protections have run on GitHub.

For nondefault local ports, use `EPI_LESS_PORT` for web setup/tests and `EPI_LESS_WEB_URL` for extension builds/tests. See the [quickstart](../README.md#quickstart). Stop the local server before tests that manage their own preview, or explicitly use the documented existing-server mode.

Numeric reference reports now include an `engineSourceTree` hash of every source file, with relative paths and an explicit encoding basis. The legacy `engineSourceSha256` field still hashes only the API entry file; do not treat that field alone as the identity of the split implementation.

## Where evidence belongs

| Location                               | Meaning                                                                                    | Maintenance rule                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `tests/reference/`                     | Frozen external fixtures, selection manifests, oracles and executable regression harnesses | Preserve upstream attribution, checksums and selection boundaries              |
| `packages/analysis-engine/validation/` | Retained numeric experiments, production proofs, failures and reconstruction patches       | Preserve existing records byte-for-byte; add a new dated result for new claims |
| `tests/extension/evidence/`            | Retained native exports, provenance, failed attempts and verifier snapshots                | Preserve original bytes and source identity, including old names               |
| `tests/extension/fixtures/`            | Controlled fixture assets used by current harnesses                                        | Respect the manifest/hash contracts; changing a fixture requires a new proof   |
| `artifacts/`                           | Regenerable output of current local/CI runs                                                | Git-ignored; upload as a CI artifact or explicitly curate new evidence         |

Historical experiments stay at their original paths because documents, manifests and provenance records refer to them. They are not moved or prettified as part of a source cleanup. `rejected`, `before`, `prototype`, `unreached` and `baseline` records remain useful failure/reference evidence, never release approval. A file called `production-proof` still has a source and environment boundary.

Archive navigation: [numeric experiments](../packages/analysis-engine/validation/INDEX.md) and [native extension evidence](../tests/extension/evidence/README.md). The existing numeric reference README is retained separately.

## Native validation and unresolved claims

- [CAPTURE_VALIDATION](CAPTURE_VALIDATION.md): native toolbar capture, viewport restoration, media timing and ownership scenarios, with exact observed limits.
- [SCANNER-QUALITY](SCANNER-QUALITY.md): detector capability and validation gaps.
- [P0-ACCEPTANCE](P0-ACCEPTANCE.md): local implementation versus deferred hosting/release gates.
- [IMPLEMENTATION](IMPLEMENTATION.md): implementation history and measured snapshots.

Only this Mac is currently available. A source refactor does not supply the missing second-machine evidence, broader browser/OS coverage, independent normative validation or production hosting checks. In particular, do not infer new native capture/cancel acceptance from a UI smoke test or a mocked capture test.
