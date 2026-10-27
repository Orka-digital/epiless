# Detector experiments and retained results

Start with the [validation map](../../../docs/VALIDATION.md) for current commands and the [scanner quality record](../../../docs/SCANNER-QUALITY.md) for unresolved claims.

This directory mixes an executable numeric reference (`run.ts` and its local helpers) with frozen research results. The ordinary source is in `../src`; current benchmark harnesses are in `../bench` and `../../../scripts`.

| Group                                                           | Purpose                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `reference-results.json` and numeric reference helpers          | Small, independently specified temporal regression corpus                     |
| `dense-color-*`, `full-mask-*`, `raw-reuse-*`, `dense-loop-*`   | Throughput experiments, before/after snapshots and rejected optimizations     |
| `wasm-*`                                                        | Backend differential experiments, reconstruction archives and retained proofs |
| `detection-*`, `expanded-*`, `spatial-media-*`, `alternating-*` | Results for explicitly identified external/reference selections               |
| `*.patch`, `*.json.gz`                                          | Exact reconstruction/provenance, not files to regenerate casually             |

A production-proof filename is not current-build acceptance. Check its source hash, comparison basis and limitations. Rejected experiments are retained to explain why an optimization was not adopted. Never reformat or overwrite the existing results; write a new run to `artifacts/` and review it separately.

The cleanup preserves the old records. New numeric reference output includes a complete `engineSourceTree` identity because `src/index.ts` is now an API facade; hashing the entry file alone no longer identifies the detector implementation.
