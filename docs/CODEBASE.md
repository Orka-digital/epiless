# Codebase map

Start here when changing epi-less. The scanner's public behaviour and numeric reference results are contracts; splitting a file does not constitute new detector validation.

## Extension

`apps/chrome-extension/src/background.ts` is the service-worker composition root. It constructs the execution, capture and browser-workspace owners from `runner-runtime.ts`, wires services, recovers persisted jobs, and registers Chrome event listeners. Service factories do not start work during construction. Execution leases release only their own authorization/preparation; clock and segment cleanup must match the active generation. `runner-contracts.ts` defines shared operation signatures once; each factory declares the subset it needs. Lazy getters resolve operation dependencies, not mutable scalar state.

| Module                    | Responsibility                                                   |
| ------------------------- | ---------------------------------------------------------------- |
| `runner-commands.ts`      | UI commands, snapshot transfer and start intents                 |
| `runner-authorization.ts` | Real toolbar authorization and capture startup                   |
| `runner-scheduler.ts`     | Job queue, task completion and terminal cleanup                  |
| `runner-exploration.ts`   | Bounded route interactions, scrolling, media and compact samples |
| `runner-navigation.ts`    | Lease/origin/budget guards, page messaging and navigation        |
| `runner-observation.ts`   | Measurement segments, source evidence and targeted replay        |
| `runner-capture.ts`       | Capture-source ownership, viewport workspaces and restoration    |
| `runner-advanced.ts`      | Disposable scan-tab ownership, recovery and closure              |
| `runner-offscreen.ts`     | Offscreen-document lifetime, messages and timeouts               |
| `runner-policy.ts`        | Pure queue, coverage and lease policies                          |

The services are explicit parameters, not imports back into `background.ts`. Keep browser access behind the existing ownership checks. A cleanup failure must remain observable in the stored job. Do not turn an interrupted scan into a completed scan merely to simplify a state transition.

`ui.tsx` composes the view. `useScannerConnection.ts` owns polling, command feedback and gesture-bound capture actions; stale polling responses are discarded. `useScanSelection.ts` owns selection and filters; `useScanExports.ts` owns export actions and privacy selection. `command-protocol.ts` defines the discriminated background-command union and validates incoming commands before dispatch. `command-client.ts` links command arguments to response types. Internal content/worker transports retain their existing separate contracts. `ScanStart`, `ScanMeasurements`, `ScanHistory`, `ScanSettings` and `ScanSidebar` render the separate workspaces. `ui-state.ts` describes the worker response; `ui-labels.ts` holds display labels. Report controls retain their existing callbacks and observation identifiers.

## Detector

`packages/analysis-engine/src/index.ts` is the public API. It re-exports the existing API without changing the engine version.

- `frame-analyzer.ts`: frame ingestion and detection orchestration.
- `frame-memory.ts`: buffer allocation, memory budgets and backend initialization; protected fields remain directly accessible in pixel loops.
- `analysis-result.ts`: final quality, limitations and result assembly.
- `transition-history.ts`: general/red rolling-window history and opposing pairs.
- `candidate-clusters.ts`: connected components, spatial witnesses and candidate reporting.
- `types.ts` and `luminance.ts`: input/output contracts and the public luminance helper.
- Existing `spatial.ts`, `diagnostic-history.ts`, `color-cache.ts` and `wasm-dense.ts`: spatial analysis, bounded diagnostics, exact colour lookup and the dense backend.

Do not widen the public API to expose implementation helpers. Preserve Float64 timing, half-open windows, bounded state, strongest-witness selection and exact JS/WASM equivalence when refactoring.

## Automated maintenance checks

`pnpm check` runs strict typechecks, unused-local/parameter checks, switch fallthrough checks, formatting, documentation contracts and `pnpm check:unused` (Knip). CI's existing required `checks` job runs the same command. `tsconfig.scripts.json` adds `checkJs` to root tooling, CI scripts, package scripts/benchmarks and the extension build. It uses `strict` and `noImplicitAny`: helper inputs have JSDoc contracts and shared fixture/I/O types in `scripts/helper-types.ts`. Differential harnesses use `bench/probe-types.ts` for their explicit structural view of frozen/current engine internals. Missing corpus bytes, labels and benchmark results fail explicitly. JSON and dynamically loaded modules retain runtime validation; static types do not validate external data. Frozen evidence and copied browser fixtures are outside this helper configuration.

Knip checks unused files, exports, types and dependencies, plus undeclared imports. `knip.jsonc` lists nonstandard Chrome entrypoints and manually invoked validation tools. Runtime modules, system binaries and generated fixture imports have narrow, documented exceptions. Public package exports remain public API; a library export is not dead simply because the current app does not call it. Frozen evidence and external corpora are outside executable-source discovery. Do not add all source files as entrypoints or blanket-ignore new findings to make a check pass.

The root declares esbuild because root browser tests import it directly. The website uses system fonts; no webfont package or old product-preview image is needed.

See [validation map](VALIDATION.md) for which checks prove which claims.
