# Codebase map

Start here when changing epi-less. See [maintainability gates and refactor evidence](MAINTAINABILITY.md) for required checks and remaining debt. The scanner's public behaviour and numeric reference results are contracts; splitting a file does not constitute new detector validation.

## Extension

`apps/chrome-extension/src/background.ts` is the service-worker composition root. It constructs the execution, capture and browser-workspace owners from `runner-runtime.ts`, wires services, recovers persisted jobs, and registers Chrome event listeners. Service factories do not start work during construction. Execution leases release only their own authorization/preparation; clock and segment cleanup must match the active generation. `runner-contracts.ts` defines shared operation signatures once; each factory declares the subset it needs. Lazy getters resolve operation dependencies, not mutable scalar state.

| Module                    | Responsibility                                                   |
| ------------------------- | ---------------------------------------------------------------- |
| `runner-commands.ts`      | Validated command dispatch to focused handlers                   |
| `runner-authorization.ts` | Real toolbar authorization and capture startup                   |
| `runner-scheduler.ts`     | Job queue, task completion and terminal cleanup                  |
| `runner-exploration.ts`   | Bounded route interactions, scrolling, media and compact samples |
| `runner-navigation.ts`    | Lease/origin/budget guards, page messaging and navigation        |
| `runner-observation.ts`   | Capture lifecycle and observation orchestration                  |
| `runner-capture.ts`       | Capture-source ownership, viewport workspaces and restoration    |
| `runner-advanced.ts`      | Disposable scan-tab ownership, recovery and closure              |
| `runner-offscreen.ts`     | Offscreen-document lifetime, messages and timeouts               |
| `runner-policy.ts`        | Pure queue, coverage and lease policies                          |

`runner-command-*` separates preparation, start, lifecycle, state messages and history commands. `runner-job-factory.ts` builds initial job data without browser/storage mutations. `runner-replay.ts` owns replay prerequisites; `observation-source`, `observation-evidence`, `observation-coverage`, `observation-recipe` and `observation-result` own the corresponding capture stages. `measurement-protocol.ts` validates worker results and defines explicit unopened/capturing/completed/interrupted segment states.

`store.ts` remains the storage entrypoint. `store-db` owns IndexedDB transaction primitives; `store-control`, `store-jobs`, `store-retention` and `store-transfers` own their mutations. `store-control-schema` validates persisted start/recheck/preferences/retention records. Corrupt authorization records never start scans; corrupt retention settings preserve details. Historical job/report records retain their existing compatibility format.

The services are explicit parameters, not imports back into `background.ts`. Keep browser access behind the existing ownership checks. A cleanup failure must remain observable in the stored job. Do not turn an interrupted scan into a completed scan merely to simplify a state transition.

`ui.tsx` composes the view through `ToolHeader`, `ScanRecoveryNotices` and `ScanReportCard`. The report card accepts measurements as children instead of owning their filtering and inspection state. `useScannerConnection.ts` owns polling, command feedback and gesture-bound capture actions; stale polling responses are discarded. `useScanSelection.ts` owns selection and filters; `useScanExports.ts` owns export actions and privacy selection. `command-protocol.ts` defines the discriminated background-command union and validates incoming commands before dispatch. `command-client.ts` links command arguments to response types. Internal content/worker transports retain their existing separate contracts. `ScanStart`, `ScanMeasurements`, `ScanHistory`, `ScanSettings` and `ScanSidebar` render the separate workspaces. `ui-state.ts` describes the worker response; `ui-labels.ts` holds display labels. Report controls retain their existing callbacks and observation identifiers.

### Page content and media replay

`content.ts` owns installation, message dispatch, cancellation generations and restoration. `content-tree.ts` owns bounded document/open-shadow traversal and refreshable selector caches. Its state is read through getters so policy helpers cannot retain stale arrays. `content-dom.ts` provides composed-tree visibility and hit testing; `content-controls.ts` implements conservative control safety and state predicates; `content-inventory.ts` owns stable element IDs and the current route/control inventory. The existing form, modal, CAPTCHA, transaction and traversal-limit denials remain unchanged.

`media-replay.ts` remains the consumed entrypoint. `media-replay-types.ts` holds the transport shapes and limits; `media-replay-validation.ts` validates and copies allowlisted fields; `media-replay-interval.ts` checks playback/compositor continuity; `media-replay-plan.ts` builds bounded plans and their key material; `media-replay-comparison.ts` compares original and repeated evidence. Matching a locator or an advancing playback clock still cannot prove that all original presentations recurred.

## Publication service

`apps/web/src/server/publications.ts` retains the handler-facing function exports. Implementation modules import each other directly:

- `publication-types.ts`: schema-inferred storage type and explicit transport contracts.
- `publication-presentation.ts`: visibility parsing and owner/public metadata projection.
- `publication-queries.ts`: access-controlled detail and bounded public/owner pagination.
- `publication-intents.ts`: snapshot validation, challenge verification and cancellation.
- `publication-mutations.ts`: publication commit, revision-bound owner updates and write-pause policy.
- `publication-moderation.ts`: abuse reports and explicit moderator access.

JSDoc records ownership, trust boundaries and race behavior. Ordinary database operations use the shared Drizzle schema in `server/db/schema.ts`. Focused database modules own queries; publication, moderation and erasure SQL batches retain their atomic guards. See [database contracts](DATABASE.md) for migration and trigger ownership. Internal row types are not re-exported through the handler entrypoint.

## Detector

`packages/analysis-engine/src/index.ts` is the public API. It re-exports the existing API without changing the engine version.

- `frame-analyzer.ts`: frame ingestion and detection orchestration.
- `frame-quality.ts` and `frame-input.ts`: input admission, cadence, geometry changes and missing-coverage accounting.
- `frame-pixels.ts`: exact dense/sparse pixel transitions and backend counters.
- `frame-tiles.ts`, `tile-geometry.ts` and `active-tiles.ts`: lossless sharing, changed-tile geometry and exact active-mask expansion. The internal `FrameMemory → FrameTiles → FramePixels` hierarchy preserves direct typed-array access in pixel loops; these implementation classes are not package exports.
- `frame-memory.ts`: buffer allocation, memory budgets and backend initialization; protected fields remain directly accessible in pixel loops.
- `analysis-result.ts`: final quality, limitations and result assembly.
- `transition-history.ts`: general/red rolling-window history and opposing pairs.
- `candidate-clusters.ts`: connected components, spatial witnesses and candidate reporting.
- `types.ts` and `luminance.ts`: input/output contracts and the public luminance helper.
- Existing `spatial.ts`, `diagnostic-history.ts`, `color-cache.ts` and `wasm-dense.ts`: spatial analysis, bounded diagnostics, exact colour lookup and the dense backend.

Do not widen the public API to expose implementation helpers. Preserve Float64 timing, half-open windows, bounded state, strongest-witness selection and exact JS/WASM equivalence when refactoring.

## Website composition

`PublishForm.tsx` composes publication controls. `components/publication/` owns route redaction, exact snapshot preview, visibility/approval, publication outcome and queue rendering. In `lib/publication/`, `use-publication-draft.ts` owns local import and invalidates approval after edits; `use-upload-queue.ts` observes durable jobs and account changes; `use-publication-upload.ts` owns the upload lease, intent verification, retry and cancellation. Widgets receive typed data and callbacks; they do not perform storage or network requests. Approval still binds the exact redacted snapshot before anything is sent.

`ReportView.astro` composes `components/report/`: identity/totals, paginated routes, scenario evidence, limitations and scan context. The sections remain server-rendered and usable without JavaScript. Styles live with their owning component; only shared section/paging styles reach through the report root. These components do not change report pagination or detector conclusions.

## Web form hydration

`apps/web/src/lib/use-hydrated.ts` owns the shared SSR/client snapshot for interactive form controls. Its server snapshot keeps actions disabled until hydration completes; the client snapshot enables them without an effect that only sets state. Each form still owns its requests and user-facing failures. `Challenge.tsx` manages the external Turnstile widget, updates callback refs after commit, and tears down the widget when its identity or configuration changes.

## Automated maintenance checks

`pnpm check` runs strict typechecks, unused-local/parameter checks, switch fallthrough checks, semantic linting, formatting, documentation contracts and `pnpm check:unused` (Knip). CI's existing required `checks` job runs the same command. `tsconfig.scripts.json` adds `checkJs` to root tooling, CI scripts, package scripts/benchmarks and the extension build. It uses `strict` and `noImplicitAny`: helper inputs have JSDoc contracts and shared fixture/I/O types in `scripts/helper-types.ts`. Differential harnesses use `bench/probe-types.ts` for their explicit structural view of frozen/current engine internals. Missing corpus bytes, labels and benchmark results fail explicitly. JSON and dynamically loaded modules retain runtime validation; static types do not validate external data. Frozen evidence and copied browser fixtures are outside this helper configuration.

`eslint.config.mjs` applies recommended JavaScript, TypeScript, Astro and React Hooks checks plus JSDoc tag validation. Production TypeScript uses project-service type information for promise and assertion checks. ESLint rejects warnings, unused suppression comments and files above 250 code lines. `.eslint-file-limits.json` records exact ceilings for existing oversized files and must shrink as they are split; test mocks have an explicit `any` exception. Prettier owns formatting and its compatibility config is applied last. The contribution guide documents the commands and exclusions.

Knip checks unused files, exports, types and dependencies, plus undeclared imports. `knip.jsonc` lists nonstandard Chrome entrypoints and manually invoked validation tools. Runtime modules, system binaries and generated fixture imports have narrow, documented exceptions. Public package exports remain public API; a library export is not dead simply because the current app does not call it. Frozen evidence and external corpora are outside executable-source discovery. Do not add all source files as entrypoints or blanket-ignore new findings to make a check pass.

The root declares esbuild because root browser tests import it directly. The website uses system fonts; no webfont package or old product-preview image is needed.

See [validation map](VALIDATION.md) for which checks prove which claims.

## Regression ownership

Backend publication suites are grouped by access, quotas, idempotency, moderation, account management, origin policy and pagination. `tests/backend/publication-fixture.ts` owns synthetic setup and the normal approval/publication flow. Tests use actual migrations and SQLite transactions.

The three-engine differential harness retains exact temporal-state, callback, memory and spatial-witness assertions. `bench/state-comparison.mjs` owns state comparisons; `bench/quality-probe.mjs` reads relocated quality counters without changing their values or relaxing assertions. Frozen reference sources remain unchanged.
