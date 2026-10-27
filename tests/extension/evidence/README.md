# Retained native evidence

These are historical records, not a test suite or a release checklist. Start with the [validation map](../../../docs/VALIDATION.md), then the [native capture record](../../../docs/CAPTURE_VALIDATION.md) for the source fingerprint, fixture and limitations of each claim.

| File group                                                        | Interpretation                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `*-local-job.json`                                                | Original persisted scan/measurement exports                      |
| `*-provenance.json`, `*-request-log.json` and environment records | Source, browser, context and execution boundaries                |
| `*-before*`, `*-rejected*`, `*-failed*`, `*-unreached*`           | Baseline/failure evidence; never acceptance of the attempted fix |
| `*-pass*`, `*-proof*`, `*-verified*`                              | Evidence only for the recorded build and tested scenario         |
| `*.patch`, verifier snapshots                                     | Reconstruction of a historical attempt or decision               |

Preserve existing files byte-for-byte, including original product identifiers and URLs. Do not rename, reformat, pseudonymize in place, or overwrite them after a rerun. Write current output to the Git-ignored `artifacts/` directory; curate new evidence under a new name only when its provenance and limitations are recorded.

The current browser regressions load selected original exports to check UI and compatibility. That does not recreate the original native capture, validate a new scanner build on another machine, or prove causal DOM attribution. The ordinary and advanced capture gates are described in the capture record, not inferred from filenames.
