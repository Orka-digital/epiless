# Native capture validation

This record separates native browser capture from numeric tests, decoded-file validation and DOM fixtures. Historical toolbar-authorised runs on **27 October 2026** (Europe/Brussels) established bounded capture and navigation on one browser configuration. Retained **0.4 candidate** runs demonstrate adequate cadence on a benign viewport, tiny-detail detection/rechecks, physical compact capture and a sparse HTML-video fixture. Each result belongs to its recorded build. No hardware/browser matrix or public release acceptance has been completed.

## Current source and retained capture boundaries

**Checkpoint boundary:** a new ordinary native phase/media sequence on scanner `7fc0a67c…` / engine `0ce8fedc…` now validates one selected encoded-video fix/recurrence with the document-phase guard enabled. Its records are separate from the earlier encoded/dense/media-recheck checkpoint on scanner `6770f520…` / engine `c216fbe2…`. Old recordings are not recast as evidence for later changes; old jobs without phase evidence cannot establish a negative comparison under the new guard. Advanced cancellation remains unaccepted: the `7fc0a67c…` attempt did not reach the rebind fallback; a subsequent `fdcb09c5…` attempt executed all eight rebind phases but still failed exact CSS restoration.

Engine source **`c216fbe2c9de76354061c35ba4df09e7e0a25731e5be247f3a7092aca2ca687a`** at the retained native checkpoint keeps the strongest complete spatial witness from one actual frame when candidates merge; its counts, timestamp, pattern and motion remain tied to that frame. Source joins require an actual DOM-read interval overlapping the estimated detecting window. The ±150 ms margin supplies context only, and a viewport revision change makes the join incomplete even if geometry returns to its earlier values. Capture-to-DOM latency remains unknown. The bundled **2,239-byte ABI 2** C/WASM kernel is unchanged.

The [new three-engine proof](../packages/analysis-engine/validation/wasm-spatial-witness-0.4.0-production-proof.json) checks **144 cases**: **23,058 temporal-state comparisons** against frozen `342483aa…` and another **23,058** against current forced JS, **1,626 findings/callbacks**, **10,159 WASM calls** and **522 mixed-history calls**. Independent connected-component and brute-force field calculations reconstruct **4,698 actual masks**. Exactly **six intentional spatial replacements** are justified by complete frame witnesses: 68 pixels at 916.67 ms become 71 pixels at 1000 ms. Current forced JS and AUTO agree on complete per-frame findings and final reports, with explicit memory accounting as the only normalization. The frozen oracle and earlier proof files remain unchanged.

All three external gates were rerun on `c216fbe2…`: [original temporal](../packages/analysis-engine/validation/detection-spatial-merge-0.4.0.json), [expanded temporal](../packages/analysis-engine/validation/expanded-spatial-merge-0.4.0.json) and [spatial/decoded media](../packages/analysis-engine/validation/spatial-media-spatial-merge-0.4.0.json) each report **`NO_NEW_MISMATCHES`**. Counts remain 11 TP / 0 FN / 2 FP / 29 TN, and 129 / 0 / 18 / 251 with two malformed unscored files. The 24-mask/36-video matrix preserves all disagreements and **1,204 exact decoded frame hashes/timestamps**. These are numeric and regression checks, not a fresh native-capture acceptance.

The **27 October 2026 checkpoint** on scanner source **`5ecdc445abed75a44a5ae3f56b7d36a231f0aa8516e1b3127e3e6e1afe188c3b`** passes **398 unit/integration tests in 44 files** and `pnpm check`. After further media/stop guards and reversal of the rejected producer hold, checkpoint **`8a8f9e067bbe94c1de2396bc27a9200abcaff498edca1363b8514a271bff9d27`** passes **400 tests in 43 files**. The later scanner **`6770f52087d2cfeb0b8206677e4076056385f64d1bac660063d79f7164ce4f61`**, including the late-loop replay guard, passes **423 tests in 45 files**, including six new fixture/verifier regressions. These recorded checks do not automatically cover later edits. The corresponding advanced cancellation experiment fails at 450 rather than 507 CSS pixels despite releasing resources and preserving foreground context; its strict result is documented below. The ordinary autonomous-loop first run reaches and independently proves two video wraps, but its 35.53 fps loop capture fails the quality gate. A later explicitly stimulated cadence variant on scanner `6770f520…` passes at 59.995 fps; both separate results and their build/fixture boundaries are below.

A separate [first-encounter combo corpus](../tests/reference/trace-combo-heldout/README.md) adds **eight previously unused upstream inputs and sixteen correlated general/red channel checks**, selected and hash-pinned before scoring unchanged `c216fbe2…`. Its single recorded evaluation yields **8 TP / 0 FN / 1 FP / 7 TN**, with no malformed/unscored inputs. `001fl.csv` produces an unexpected red candidate at 200–900 ms; the upstream expectation remains unchanged. An [independent numeric worksheet](../tests/reference/trace-combo-heldout/001fl-red-adjudication.json), without an engine import, explains six immediate versus eight retained-endpoint qualifying transitions; normative endpoint interpretation remains unresolved. This is limited new numeric evidence, not a native capture or general accuracy result. After first encounter this corpus becomes regression data as well.

The **historical `6770f520…` scanner / `c216fbe2…` engine checkpoint** also passes the complete seven-script extension browser chain, `pnpm check`, and the two native encoded/dense repeats below. Those fixtures use ordinary artifact **`d0ac12bb19825c77f5d796bdbfa8b06eb965d539d53c4144c2fc2ff25ad8a7fc`**; the dense fixture instruments only a temporary copy. Earlier `af5d4da0…` / `f6611f36…` captures, 359-test checkpoint and 1,630-case internal reference remain historical evidence. Native acceptance covers the recorded fixtures on one Mac; it establishes no general 60 fps, hardware, codec or conformance claim.

## Native phase-aware encoded-media fix and recurrence on 7fc

Three new real-toolbar captures use unchanged scanner **`7fc0a67cee272b48a711698f9c4343a9c3d4fdcb1191214f1ed3fa52f859465c`**, engine **`0ce8fedc…`** and ordinary artifact **`5d2e1616e4e42c65a69966be4f9fe97bd316baa04e99cedb6c1fd79b5af7bf8e`**. The [strict phase/media verification](../tests/extension/evidence/scanner-v04-native-phase-media-recheck-verification.json) passes **`NOT_OBSERVED` → `REOBSERVED`** against the original candidate/observation anchor. [Provenance](../tests/extension/evidence/scanner-v04-native-phase-media-recheck-provenance.json) binds the byte-exact three local jobs, public reports, environments, fixture sources and 69-file scanner source snapshot. All three public report schemas pass.

| Selected current-profile control | Frames |      Cadence | Maximum gap |  Document interval |
| -------------------------------- | -----: | -----------: | ----------: | -----------------: |
| Original signal                  |    307 | 59.98941 fps |     18.4 ms | 20387.1–25508.2 ms |
| Fixed source                     |    315 | 59.99465 fps |     18.3 ms | 20267.5–25513.6 ms |
| Restored signal                  |    315 | 59.99121 fps |     18.0 ms | 20274.4–25512.8 ms |

Each selected observation retains **1800 × 1126 native pixels**, without reported interruption or rescaling, and all **53 actual video PTS, 0–2080 ms at 40 ms intervals**, with continuous compositor counters. Complete `DOCUMENT` phase evidence contains one CSS animation. Both repeated observations cover the entire original document interval; the phase and media compatibility guards return no reasons. The measured media interval is 0–2120 ms. The same immutable signal/fixed/signal files, stable locator and unchanged **20-second low-contrast marker** are used; independent document, file-request and served-HTML hashes bind the intentional site-content changes. There is no stronger cadence variant or synthetic capture start.

This accepts the selected disclosure control and its targeted comparison on one Mac. Whole-job states are **`PARTIAL`, `COMPLETED`, `COMPLETED`**. The baseline's separate initial viewport remains interrupted (**900 frames, 33.3 ms maximum gap**); the successful comparison does not convert it or the complete route into accepted coverage. Capture-to-DOM latency, arbitrary media, broader hardware and advanced cancellation restoration remain outside this proof. The earlier phase-free chain below stays unchanged historical evidence.

## Historical native encoded-media fix and recurrence on 6770

Three fresh, real-toolbar captures on unchanged scanner **`6770f520…`**, engine **`c216fbe2…`** and artifact **`d0ac12bb…`** now pass one bounded media recheck sequence. The [strict verification](../tests/extension/evidence/scanner-v04-native-media-recheck-verification.json) and [byte-preserving provenance](../tests/extension/evidence/scanner-v04-native-media-recheck-provenance.json) bind the [baseline](../tests/extension/evidence/scanner-v04-native-media-recheck-baseline-local-job.json), [fixed](../tests/extension/evidence/scanner-v04-native-media-recheck-fixed-local-job.json) and [recurrence](../tests/extension/evidence/scanner-v04-native-media-recheck-recurrence-local-job.json) jobs, their reports and independent per-document page traces. The unchanged product comparison returns **`NOT_OBSERVED`** for the targeted fix and **`REOBSERVED`** for recurrence against the original candidate/observation anchor.

| Measured current-profile control | Native pixels | Frames |      Cadence | Maximum gap | Actual video PTS |
| -------------------------------- | ------------: | -----: | -----------: | ----------: | ---------------- |
| Original signal                  |   1800 × 1126 |    307 | 59.99412 fps |     17.9 ms | 53, 0–2080 ms    |
| Fixed source                     |   1800 × 1126 |    306 | 59.99095 fps |     17.8 ms | 53, 0–2080 ms    |
| Restored signal                  |   1800 × 1126 |    307 | 59.98706 fps |     18.4 ms | 53, 0–2080 ms    |

Every source PTS is presented in order at 40 ms intervals, with continuous real compositor counters and independent page metadata matches. The measured media interval is 0–2120 ms in all three runs. Capture quality, source/recipe compatibility and original candidate identity pass without relaxing product thresholds. The signal and recurrence retain the exact 4 × 4 native candidate and correlated video timing. All three public report schemas pass. Whole-job states are respectively **`PARTIAL`, `COMPLETED`, `PARTIAL`**; successful targeted observations do not turn unmeasured navigation/other states into coverage.

This is an explicit fixture variant: one stable URL serves the original immutable signal, then the immutable constant control, then the original signal again, across distinct documents. File bytes intentionally differ for the site fix; duration, PTS, rate and locator remain equal. Independent manifest/request hashes establish those fixture bytes; the scanner's URL-locator hash does not establish content identity. The disclosure plays a video already paused at zero without the original fixture's redundant seek. The existing **20-second low-contrast cadence marker is unchanged**, with no stronger cadence variant. Capture still requires each real toolbar action; preparation commands do not synthesize capture or issue `START`.

The [first verifier failure](../tests/extension/evidence/scanner-v04-native-media-recheck-verification-before-window-scope.json) and [original verifier source](../tests/extension/evidence/scanner-v04-native-media-recheck-verifier-before-window-scope.mjs) are retained. That verifier rejected normal restoration events **5.7/9.6 ms after media evidence ended**, also after capture observation END, when the runner restored exactly the saved zero position. The corrected verifier permits at most one such later restoration and still rejects any seek before/during measurement, between media STOP and observation END, or to another position; media errors remain failures everywhere. Original captures, product code and fixture did not change for this verifier correction.

This closes one current-profile encoded-media fix/recurrence check on this Mac. It does not validate arbitrary media, multi-video/loop rechecks, compact replay, causal source attribution or advanced cancellation restoration. The separate earlier current encoded/dense captures below **still retain `MEDIA_REPLAY_NOT_REPRODUCIBLE`**; their evidence is not rewritten by this successful variant.

## Historical native dense repeat on 6770

The [report](../tests/extension/evidence/scanner-v04-native-current-dense-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-current-dense-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-current-dense-environment.json), [strict verification](../tests/extension/evidence/scanner-v04-native-current-dense-verification.json) and [byte-preserving provenance](../tests/extension/evidence/scanner-v04-native-current-dense-provenance.json) repeat the tiny video candidate over five seconds of changing low-contrast GPU RGB content on current scanner `6770f520…` / engine `c216fbe2…`. A real toolbar action authorizes capture. The copied offscreen probe has SHA-256 `a753afbe5d7dbab57ddd3a14988c4e0daaf574def5e80cb06a61601403a40b8c`; periodic corner readback overhead is included, no images are retained and production `dist` is unchanged.

| Triggered observation | Native pixels | Frames |      Cadence | Maximum gap | Mean worker / analysis | Kernel frames |
| --------------------- | ------------: | -----: | -----------: | ----------: | ---------------------: | ------------: |
| Desktop               |   1800 × 1126 |    306 | 59.99685 fps |     18.1 ms |     14.392 / 10.451 ms |           301 |
| Compact               |   1200 × 1126 |    307 | 59.79132 fps |     33.4 ms |      10.268 / 6.962 ms |           300 |

The strict **`--require-wasm`** gate passes. Both observations retain every source pixel, report no capture interruption or skipped-frame limitation and record **zero extra input-copy bytes**. Actual I420 frames use `VideoFrame.copyTo`; backend counters prove kernel execution beyond `READY` selection. Worker maxima are **25.5/18.6 ms**, with **26/2 frames** over 16.7 ms. The compact 33.4 ms source gap is retained as measured; this is not a claim of perfect 60 fps spacing.

Both retain the exact **4 × 4 native candidate**, correlated video clue and **682 × 512 `W3C_CSS_REFERENCE` field**. Ten desktop and nine compact numeric corner probes confirm changing captured background values; **21 compact rVFC records** match the independent page trace. Only the final compact document has that independent trace, and source-to-DOM latency remains unknown. Strict public report validation passes. The whole job remains **`PARTIAL` / `INCONCLUSIVE`**, with `passed: null`, and both positive measurements retain **`MEDIA_REPLAY_NOT_REPRODUCIBLE`**. This proves the positive capture/diagnostic path for this workload, not a compatible negative media recheck, arbitrary entropy throughput or advanced cancellation restoration.

## Historical encoded VP9 repeat on 6770

The separate [report](../tests/extension/evidence/scanner-v04-native-current-encoded-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-current-encoded-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-current-encoded-environment.json), [verification](../tests/extension/evidence/scanner-v04-native-current-encoded-verification.json) and [byte-preserving provenance](../tests/extension/evidence/scanner-v04-native-current-encoded-provenance.json) pass on the same current source and ordinary artifact, without offscreen corner instrumentation. The immutable **3,281-byte, 2 × 2 lossless VP9/WebM** source has 53 frames at 25 fps; every decoded RGBA byte and source PTS was checked during preparation. Its source SHA-256 remains `03bf0717f3b337b11a91c92f7caa31337a38d0644b795a8ae7e3ea4e74240092`, and manifest SHA-256 remains `c6ffd34d863227489ea8bcd3924cc5e520f9e67ca11bac05a3f9f2c076acb73c`.

| Triggered observation | Native pixels | Frames |      Cadence | Maximum gap | Mean worker / analysis |
| --------------------- | ------------: | -----: | -----------: | ----------: | ---------------------: |
| Desktop               |   1800 × 1126 |    306 | 59.99567 fps |     18.0 ms |       8.191 / 4.264 ms |
| Compact               |   1200 × 1126 |    307 | 59.99765 fps |     17.8 ms |       6.353 / 3.035 ms |

The exact **4 × 4 candidate**, **682 × 512 CSS-reference field**, correlated video clue and **zero grey-channel error** survive the file → browser decoder → native capture → diagnostic/export path. **20 compact rVFC presentations** match the independent page metadata. No playback occurs before disclosure, and the source has no audio. The sparse workload uses shared JS histories and records **zero dense kernel calls**; it is not a WASM performance measurement. Strict public report validation passes. Both positive controls are `NEEDS_REVIEW`, but retain **`MEDIA_REPLAY_NOT_REPRODUCIBLE`**; the whole job remains **`PARTIAL` / `INCONCLUSIVE`**. This is one tiny encoded source on the recorded Mac/Chrome configuration, with unknown capture-to-DOM latency, not broad video/codec accuracy or reproducible negative media verification.

## Controlled loop cadence variant passes

The [report](../tests/extension/evidence/scanner-v04-native-loop-cadence-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-loop-cadence-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-loop-cadence-environment.json), [strict verification](../tests/extension/evidence/scanner-v04-native-loop-cadence-verification.json) and [byte-preserving provenance](../tests/extension/evidence/scanner-v04-native-loop-cadence-provenance.json) retain a later real-toolbar run on scanner **`6770f52087d2cfeb0b8206677e4076056385f64d1bac660063d79f7164ce4f61`**, engine **`c216fbe2…`**, artifact **`d0ac12bb19825c77f5d796bdbfa8b06eb965d539d53c4144c2fc2ff25ad8a7fc`**. This controlled fixture has explicit capture-cadence stimulation: the same 4 × 4 CSS-pixel `#e8e8e8` point on `#eee` travels 180 pixels linearly in **2 seconds instead of 20**, alternating direction. The immutable constant-grey VP9 file, its 64 × 64 CSS display size and the original page module remain unchanged. There is no flashing signal or audio.

The autonomous `media-loop-boundary-1` observation retains **310 native 1800 × 1126 frames at 59.99534 fps**, maximum gap **17.8 ms**, with no reported skips, interruption or rescaling. Mean worker processing is **7.835 ms**, maximum **30.2 ms**. Its complete media interval runs from **1,120 to 6,280.2 ms unwrapped**, with **two currentTime wraps, two presentation wraps and 129 real rVFC presentations**. Independent page records contain the same two wraps and 129 presentations; **104 sampled presentation states match**. The strict verifier passes with its original ≥50 fps and native-pixel requirements unchanged.

This is acceptance of one supported autonomous loop observation on the recorded Mac and browser. The complete job remains **`PARTIAL` / `INCONCLUSIVE`** because other states are explicitly incomplete; `passed` remains `null`. The sparse fixture uses shared JS processing and records zero dense kernel calls, so it is not a new WASM-throughput benchmark. The first failure below used **another scanner build** (`8a8f9e06…`); changing both build and marker period is not an isolated causal test of the previous cadence loss. No explanation of that loss, general 60 fps, arbitrary video or conformance claim follows from this result.

```sh
EPI_LESS_FIXTURE_LOOP_CADENCE=1 EPI_LESS_FIXTURE_LOOP=1 EPI_LESS_FIXTURE_ENCODED=1 node tests/extension/native-fixture.mjs
node --import tsx tests/extension/verify-native-loop.mjs path/to/local-job.json path/to/report.json path/to/environment.json
```

The environment and verifier bind the original page-module hash, exact wrapper hash/policy and served-HTML hash. The original first-run files remain byte-identical, and the updated verifier reproduces their original failed result exactly.

## Autonomous encoded loop: boundary reached, capture quality failed

The ordinary real-toolbar run on scanner **`8a8f9e067bbe94c1de2396bc27a9200abcaff498edca1363b8514a271bff9d27`** uses the existing immutable constant-grey VP9 file, displayed as a muted 64 × 64 CSS-pixel loop. It has no flashing signal or audio. The [report](../tests/extension/evidence/scanner-v04-native-loop-first-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-loop-first-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-loop-first-environment.json), [strict verifier](../tests/extension/evidence/scanner-v04-native-loop-first-verification.json) and [provenance](../tests/extension/evidence/scanner-v04-native-loop-first-provenance.json) preserve this first result unchanged.

The runner autonomously reaches `media-loop-boundary-1` and records `TESTED`: it prepares the finite source near its end, then measures five seconds. The retained media interval starts at **1,120 ms**, ends at **6,278.6 ms unwrapped**, and contains **two currentTime wraps, two actual presentation wraps and 128 rVFC presentations**. Independent page callbacks also show both wraps and match 104 sampled presentation states. Source/manifest/build identities and the replay recipe verify. This proves the supported loop action and local media evidence, not sufficient pixel observation.

The measured capture retains **184 native 1800 × 1126 frames at 35.527 fps**, with an **84.8 ms** maximum gap. Mean worker processing is **7.858 ms**, maximum **27.5 ms**; no frame loss, interruption or rescaling is reported. The track's advertised 60 fps is not the analysed cadence. The loop measurement is **`INCONCLUSIVE`**, and strict fixture acceptance is **`FAIL`** because capture quality is insufficient. The whole job remains `PARTIAL` / `INCONCLUSIVE`, with `passed: null`. The inadequate cadence is not attributed to a proven cause. Later repeats must remain separate evidence; this result is not relabelled or made acceptable by weakening the quality threshold.

## Native ABI 2 dense workload

The [report](../tests/extension/evidence/scanner-v04-native-wasm-dense-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-wasm-dense-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-wasm-dense-environment.json), [strict verification](../tests/extension/evidence/scanner-v04-native-wasm-dense-verification.json) and [byte-preserving provenance](../tests/extension/evidence/scanner-v04-native-wasm-dense-provenance.json) record a real toolbar start on scanner source **`af5d4da032b7a92cfbb090a1fe59adfc4601334d0d3547e6a5b9ff776c9637ce`**, engine **`f6611f36…`**. The production artifact digest is **`6774849080a96d2bb507b9d394e556d03201645e5c4565eeb579323a7c497236`**; the copied fixture's instrumented offscreen script has SHA-256 `a753afbe5d7dbab57ddd3a14988c4e0daaf574def5e80cb06a61601403a40b8c`. Original production bytes are not overwritten.

A supported disclosure triggers the tiny 2 × 2 CSS-pixel video and five seconds of changing, low-contrast GPU RGB content. Four-corner numeric probes sample the first/every 29th submitted frame and add readback overhead included in the timings. No image is retained. This is the same bounded workload family as the earlier failures, not a natural-video corpus.

| Triggered observation | Native pixels | Frames |     Cadence | Maximum gap | Mean worker / analysis | Kernel frames |
| --------------------- | ------------: | -----: | ----------: | ----------: | ---------------------: | ------------: |
| Desktop               |   1800 × 1126 |    306 | 59.9957 fps |     17.9 ms |       14.38 / 10.44 ms |           301 |
| Compact               |   1200 × 1126 |    307 | 60.0035 fps |     17.9 ms |        10.32 / 7.03 ms |           301 |

Both use actual I420 → `VideoFrame.copyTo` conversion and **zero additional input-copy bytes**. Neither reports frame loss, interruption or rescaling. Backend counters prove **301 actual kernel frames per observation**, beyond `READY` selection. Worker maxima are **27.9/18.1 ms**, and 21/3 frames exceed 16.7 ms; the bounded FIFO retains source continuity through those spikes.

Both retain the exact **4 × 4 candidate**, video source clue and **682 × 512** `W3C_CSS_REFERENCE` field. The final compact page provides **21 exact rVFC matches**; the earlier desktop document was replaced, so those records independently verify compact only. Source-to-DOM latency remains unknown. Strict public schema and `--require-wasm` acceptance pass. The two controls are `NEEDS_REVIEW`; the overall job stays **`PARTIAL` / `INCONCLUSIVE`** due to explicitly untested states, with `passed: null`.

The physical environment is Chrome for Testing 156.0.8078.4, macOS arm64, Apple M2 Max. The recorded final ordinary window matches its initial 900 × 563 CSS / 900 × 650 outer geometry at DPR 2. This is not an advanced debugger/workspace cancellation test. That separate cancellation check releases its resources but fails its exact CSS-height restoration requirement (450 instead of 507 pixels). Broader entropy workloads, natural media, colour management, other browsers and other physical computers remain outside this result.

<a id="current-build-encoded-vp9-repeat"></a>

## Retained af5 encoded VP9 repeat

A separate real-toolbar scan uses the same immutable pre-encoded 2 × 2 VP9/WebM source described [below](#native-encoded-vp9-file-through-the-complete-browser-path), on the earlier scanner **`af5d4da032b7a92cfbb090a1fe59adfc4601334d0d3547e6a5b9ff776c9637ce`** and engine `f6611f36…`. The encoded-file → browser decoder → native capture → candidate/source/export verifier passes. The [report](../tests/extension/evidence/scanner-v04-native-wasm-encoded-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-wasm-encoded-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-wasm-encoded-environment.json), [verification](../tests/extension/evidence/scanner-v04-native-wasm-encoded-verification.json) and [provenance](../tests/extension/evidence/scanner-v04-native-wasm-encoded-provenance.json) preserve the run. The ordinary artifact digest remains `6774849080a96d2bb507b9d394e556d03201645e5c4565eeb579323a7c497236`; this run has no offscreen corner-probe instrumentation.

| Triggered observation | Native pixels | Frames |      Cadence | Maximum gap |
| --------------------- | ------------: | -----: | -----------: | ----------: |
| Desktop               |   1800 × 1126 |    307 | 60.00118 fps |     18.1 ms |
| Compact               |   1200 × 1126 |    306 | 59.99803 fps |     17.8 ms |

The exact **4 × 4 source-pixel candidate**, **682 × 512** CSS-reference field and **zero grey-channel error** are preserved. **20 compact video presentations** exactly match the independent page trace; this does not separately verify the replaced desktop page's earlier presentation log. The sparse encoded signal records **zero dense kernel calls**, as expected for the shared JS route. It validates this integration path, not WASM acceleration, arbitrary video, other codecs or physical colour calibration. The overall autonomous coverage remains bounded; fixture acceptance is not a conformance or safety verdict.

## Advanced cancellation: resources released, CSS restoration failed

The [strict cancellation result](../tests/extension/evidence/scanner-v04-native-context-cancel-detach-layout-failed-verification.json), [runtime evidence](../tests/extension/evidence/scanner-v04-native-context-cancel-detach-layout-failed-evidence.json), [local job](../tests/extension/evidence/scanner-v04-native-context-cancel-detach-layout-failed-local-job.json), [report](../tests/extension/evidence/scanner-v04-native-context-cancel-detach-layout-failed-capture.json) and [environment](../tests/extension/evidence/scanner-v04-native-context-cancel-detach-layout-failed-environment.json) retain a separate advanced-build run on source **`af5d4da0…`**. Native capture, the owned debugger attachment, temporary workspace and persisted workspace state are released. The target returns to its original ownership context.

The CSS height nevertheless remains **450 instead of the required pre-attachment 507 pixels**, despite confirmed debugger detach before moving the tab back. The job records **`INTERRUPTED`** with **`VIEWPORT_WORKSPACE_RESTORE_UNCONFIRMED`**. Strict cancellation acceptance remains **failed**; successful resource release does not prove correct layout restoration. This failure is retained independently of the successful ordinary dense and encoded runs. A final [bounded height-refresh experiment](../tests/extension/evidence/scanner-v04-native-context-cancel-nudge-rejected-verification.json) also fails at 900 × 450 CSS pixels. Its one-time 650 → 649 → 650 outer-window refresh is [retained as a rejected patch](../tests/extension/evidence/scanner-v04-native-context-cancel-nudge-rejected.patch) and removed from production. That experiment returned source to the then-validated `af5d4da0…` fingerprint; it does not identify the later current source. Exact advanced CSS restoration remains open.

## Seven-second debugger-notice wait still fails exact restoration

The [retained native cancellation](../tests/extension/evidence/scanner-v04-native-context-cancel-notice-wait-failed-provenance.json) on scanner `8bb425ee…`, advanced artifact `16edc8a0…`, still fails the unchanged strict verifier. It exercises real toolbar authorization, a live compact capture and the actual debugger owner. The producer is stopped before restoration; no continued capture is used to keep the renderer active.

Chromium 156 keeps the debugger notice for [five seconds after the final detach](https://github.com/chromium/chromium/blob/156.0.8078.4/chrome/browser/extensions/api/debugger/extension_dev_tools_infobar_delegate.h#L30). The candidate extends only the confirmed terminal-detach viewport wait to seven seconds, still requiring three actual matching samples and preserving ownership/cover/focus checks. A passive fixture observer records the real detach reply. The job ends **7,053 ms later** with `VIEWPORT_WORKSPACE_RESTORE_UNCONFIRMED`; the actual source remains **900 × 450 instead of 900 × 507 CSS pixels**, including later observations. Capture/debugger release and foreground preservation succeed, but they do not establish geometry restoration. The longer wait is therefore **not an accepted fix**. The exact failed evidence, verifier rejection and scoped candidate source bytes remain preserved.

## First sequential rebind candidate: ownership check unreached

The [retained first native rebind attempt](../tests/extension/evidence/scanner-v04-native-context-rebind-owner-unreached-provenance.json) on scanner `9ec6b922…` and advanced artifact `da583753…` fails before any persisted rebind phase. Real toolbar capture reaches the compact viewport, STOP releases every observed stream and the debugger, but the ownership guard rejects the fallback. The tab remains in its unfocused workspace at **900 × 450**, versus the original **900 × 507**, with a manual return intent. The original foreground tab remains unchanged. This is an early guard failure, not an executed layout-rebind result. The strict verifier remains `FAIL`; the public report schema passes.

Exact fixture sources and all 69 scanner source/toolchain inputs are retained with hashes. A subsequent isolated Chrome storage roundtrip reproduces the implementation defect: session storage changes object-key order while preserving every field value, so raw `JSON.stringify` equality falsely rejects the same workspace. A field-order-independent comparison must still reject any actual ownership or geometry change. Correction and a new native result are separate from this unchanged failure.

## Corrected ownership comparison: fallback still unreached on 7fc

The [next native attempt](../tests/extension/evidence/scanner-v04-native-context-rebind-fallback-unreached-provenance.json) uses scanner **`7fc0a67c…`** with the field-order-independent ownership comparison. It again fails strict cancellation acceptance; its public report schema passes. There is **no persisted `REBIND` phase and no rebind residue**, so the helper is not demonstrably executed. This is a fallback-unreached result, not a completed layout-rebind experiment; the `canRebind` eligibility path remains under investigation.

The source returns **inactive to its original window and tab index**, the owned workspace closes, foreground context is preserved, all observed tracks end, the debugger detaches and ownership records clear. Actual CSS nevertheless remains **900 × 450 instead of 900 × 507**. The job ends `INTERRUPTED` with `VIEWPORT_WORKSPACE_RESTORE_UNCONFIRMED`. The exact four raw files, eight fixture sources and the matching 69-file `7fc0a67c…` source snapshot are retained. Neither the restored tab placement nor the separate successful ordinary phase/media chain establishes advanced geometry restoration.

## Sequential rebind executed: exact restoration still fails on fdcb

The [next retained native attempt](../tests/extension/evidence/scanner-v04-native-context-rebind-completed-failed-provenance.json), on scanner **`fdcb09c52fe896c193d9c7b8ab7c68c0debaf688706a93969b01d2151e7896ca`** and advanced artifact **`f8e5a62d7e6bae99faa1a19946744fd28d33156148082543981dd7e1ba5bc1f8`**, reaches the fallback. Its passive observer records all eight persisted phases, in order: `CREATE_INTENT`, `CREATED`, `ACTIVATING_PLACEHOLDER`, `PLACEHOLDER_ACTIVE`, `ACTIVATING_SOURCE`, `SOURCE_ACTIVE`, `REMOVING_PLACEHOLDER`, `REMOVED`. They span **110 ms**. This proves that the sequential placeholder/source tab switch executed; it does not prove the subsequent layout gate succeeded.

Actual CSS remains **900 × 450 instead of the original 900 × 507** after debugger release and rebind. The [strict verifier](../tests/extension/evidence/scanner-v04-native-context-rebind-completed-failed-verification.json) is **`FAIL`**; the public report schema passes. The job is `INTERRUPTED` with `VIEWPORT_WORKSPACE_RESTORE_UNCONFIRMED`. The source returns inactive to its original window and index 2, the temporary workspace closes, all observed tracks end and the debugger detaches. Rebind/workspace receipts remain because the full restoration transaction was not accepted.

The recorded foreground tab ID is unchanged, but the original window's `focused` flag is false at late collection. The evidence does not establish why it changed, so this run makes no full focus-preservation claim. Four raw files, the launch log, eight exact fixture sources and the matching 69-file source snapshot are hash-bound and retained. Earlier unreached attempts remain separate; the completed rebind is **not an accepted restoration fix**.

## Rejected live-producer restoration experiment on 5ec

The later [runtime evidence](../tests/extension/evidence/scanner-v04-native-context-cancel-live-producer-rejected-evidence.json), [local job](../tests/extension/evidence/scanner-v04-native-context-cancel-live-producer-rejected-local-job.json), [report](../tests/extension/evidence/scanner-v04-native-context-cancel-live-producer-rejected-capture.json) and [environment](../tests/extension/evidence/scanner-v04-native-context-cancel-live-producer-rejected-environment.json) retain scanner **`5ecdc445abed75a44a5ae3f56b7d36a231f0aa8516e1b3127e3e6e1afe188c3b`**, job `cf35ee17-0348-4917-b8e8-899435b37be3`. The original advanced artifact digest is `2872652bbfd3f5f3fd77a3b9b13add381e94311a7edb872159e204ecb19f8fd1`; passive stream/worker instrumentation uses a separately recorded copied artifact. The real toolbar starts capture, and STOP is issued after 30 accepted compact frames.

Keeping the existing producer alive during restoration does **not** solve the height problem. Requesting 1800 × 1014 after compact 1200 × 900 capture is rejected by the live track with `OverconstrainedError`; its advertised width/height maxima remain 1200 × 900. Those cleanup frames are not analysed. Final CSS geometry is **900 × 450**, versus the required pre-attachment **900 × 507**, at DPR 2. The job is **`INTERRUPTED`**, the report is **`INCONCLUSIVE`**, and the retained limitation is **`VIEWPORT_WORKSPACE_RESTORE_UNCONFIRMED: CAPTURE_CLEANUP_EXPIRED`**.

The [strict verifier](../tests/extension/evidence/scanner-v04-native-context-cancel-live-producer-rejected-verification.json) remains **FAILED**; the public report schema passes. The [provenance record](../tests/extension/evidence/scanner-v04-native-context-cancel-live-producer-rejected-provenance.json) binds the unchanged captured bytes. The first snapshot with all resources released is 2,565 ms after STOP: all observed tracks are ended, tab capture is stopped, the owned debugger is detached, the temporary workspace and ownership keys are absent, and the target is inactive at its original window/index. The original focused window and foreground dashboard tab match the pre-STOP state. This is resource/context evidence, not successful CSS restoration or a performance benchmark. The [experimental patch](../tests/extension/evidence/scanner-v04-native-context-cancel-live-producer-rejected.patch) is retained and reverted; its live-producer hold is not shipped. Earlier rejected nudge and fresh-window experiments remain separate historical failures. No failure is converted into an accepted result by later changes.

### Chromium source boundary for the rejected producer hold

Source review uses Chromium tag **156.0.8078.4**, matching the recorded browser. Equal initial minimum/maximum dimensions select `FIXED_RESOLUTION`, also the default tab-capture policy. The capture device supplies its maximum frame size to the WebContents frame tracker as a preferred view-size hint. This explains why negotiated source size affects capture geometry; it does not establish the cause of the later CSS-height failure. See [constraint selection](https://github.com/chromium/chromium/blob/156.0.8078.4/third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_video_content.cc) and [frame tracker](https://github.com/chromium/chromium/blob/156.0.8078.4/content/browser/media/capture/web_contents_frame_tracker.cc).

For `GUM_TAB_VIDEO_CAPTURE`, [`ApplyConstraintsProcessor`](https://github.com/chromium/chromium/blob/156.0.8078.4/third_party/blink/renderer/modules/mediastream/apply_constraints_processor.cc) finalizes against the current source format and reconfigures the track adapter; it does not take the desktop/display source-restart path. Clearing exact dimensions or replacing them with ideal/larger values therefore does not enlarge this existing producer. Its observed 1200 × 900 capability ceiling is consistent with that implementation. No applicable live producer-growth operation was identified for this path.

After the last capturer leaves, [`WebContentsImpl::DecrementCapturerCount`](https://github.com/chromium/chromium/blob/156.0.8078.4/content/browser/web_contents/web_contents_impl.cc) clears the capture-size preference. Persistent 450-pixel CSS height after confirmed release must therefore not be presented as proof of a still-active capture constraint. A delayed hidden-view/browser-chrome layout update remains an unconfirmed explanation. The strict 507-pixel restoration requirement and failed native result remain unchanged.

## ABI 1 native dense path unreached

The [retained report](../tests/extension/evidence/scanner-v04-native-wasm-shared-fallback-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-wasm-shared-fallback-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-wasm-shared-fallback-environment.json), [measurement verifier](../tests/extension/evidence/scanner-v04-native-wasm-shared-fallback-verification.json) and [failed acceptance](../tests/extension/evidence/scanner-v04-native-wasm-shared-fallback-wasm-failure.json) record scanner source `371ecd562c565127ba7f91e9cc1c83fa36737928667027a01935af71fce23fdd`. Native I420 conversion left some shared representatives; the ABI 1 all-independent guard kept `denseFrames: 0` despite `WASM_DENSE` / `READY`. No kernel throughput benefit was demonstrated.

Desktop 1800 × 1126 retained **179 frames at 35.13 fps**, with **127 skipped frames**; compact 1200 × 1126 retained **256 at 50.15 fps**, with **50 skipped frames**. Both observations were interrupted and **`INCONCLUSIVE`**. The 4 × 4 candidate, video clue, CSS reference and 21 matching compact presentations remained visible. Four-corner readback instrumentation was included in both measured timings. The measurement-only verifier preserves an inadequate result; strict WASM acceptance failed. ABI 2 addresses the selection limitation, but does not inherit a successful native measurement from this failure.

## Dense moving background: before and after

This preceding JS optimisation used engine source **`342483aad05cca930f02fc4503a11f92a7cf10bb501037c29ba9eb04bee02604`**, scanner build **`e4f04fb5da420a5232e8b250b0dbd19e7fb1d3fd1bf3034666d4e86bfef332f0`**. An exact dense-pixel and colour-processing optimisation was tested against the preceding `4a757855…` engine / `3460e19c…` scanner on the same Apple M2 Max and Chrome 156.0.8078.4. Both scans began through the real extension toolbar. Other test/benchmark jobs were stopped during capture; this does not control unrelated operating-system activity.

The [before report](../tests/extension/evidence/scanner-v04-native-dense-before-capture.json), [job](../tests/extension/evidence/scanner-v04-native-dense-before-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-dense-before-environment.json) and [verification](../tests/extension/evidence/scanner-v04-native-dense-before-verification.json) remain separate from the [after report](../tests/extension/evidence/scanner-v04-native-dense-after-capture.json), [job](../tests/extension/evidence/scanner-v04-native-dense-after-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-dense-after-environment.json) and [verification](../tests/extension/evidence/scanner-v04-native-dense-after-verification.json). The after artifact digest is `a0b52ff6ed9b31595f27c8dcb7ae03dab7534ae072adabde7953308d817e5359`.

A supported disclosure starts a five-second full-viewport WebGL2 workload behind the existing 2 × 2 CSS-pixel video. Every background channel stays between 90 and 113; it is a processing workload, not an additional flash oracle. A temporary copied offscreen bundle samples four actual capture corners on the first and every 29th submitted frame. Both runs use the identical instrumented offscreen hash, `a753afbe5d7dbab57ddd3a14988c4e0daaf574def5e80cb06a61601403a40b8c`. Periodic readback overhead is included; only numeric corner values are retained. Production `dist` is not modified by the probe.

| Triggered observation | Native pixels | Frames before → after | Analysed fps before → after | Mean worker ms before → after | Skipped/unavailable before → after |
| --------------------- | ------------: | --------------------: | --------------------------: | ----------------------------: | ---------------------------------: |
| Desktop               |   1800 × 1126 |             136 → 173 |               26.73 → 33.95 |                 37.76 → 29.54 |                          170 → 133 |
| Compact               |   1200 × 1126 |             198 → 254 |               38.75 → 49.60 |                 25.80 → 20.00 |                           108 → 53 |

Both after observations still have `interrupted: true` and **`INCONCLUSIVE`**; neither meets the capture-quality gate. Their maximum gaps are 50.8 and 34.3 ms. Mean analysis alone falls from 33.74 to 25.46 ms on desktop, and 22.45 to 16.66 ms in compact capture. Conversion remains about 4.08 and 3.32 ms. The native improvement is useful, but sustained dense-image throughput is still unfinished.

All four sampled corners change and remain within the shader range, allowing one channel value of conversion rounding. The after run retains five desktop and seven compact probe records inside the action windows. Each profile still finds the exact 4 × 4 source-pixel video candidate, its video-element clue and `W3C_CSS_REFERENCE`. In the final compact document, **21 rVFC presentations** match the independent fixture record exactly. Its GPU producer submitted 300 draws at approximately 60 fps; that is main-thread submission evidence, not a display-latency measurement. No image rescaling was used. This one before/after pair does not establish natural-video throughput, physical colour correctness or another machine's behaviour.

Reproduce with a cold extension build and the actual toolbar gesture:

```sh
EPI_LESS_FIXTURE_VIDEO=1 EPI_LESS_FIXTURE_DENSE=1 node tests/extension/native-fixture.mjs
node tests/extension/verify-native-dense.mjs path/to/local-job.json path/to/environment.json
```

The verifier accepts truthful inadequate runs as evidence and explicitly reports `bothCaptureProfilesAdequate: false`; successful verifier execution does not mean the scanner passed the cadence gate.

## Native encoded VP9 file through the complete browser path

This separate pre-WASM run uses an actual **pre-encoded VP9/WebM file**. It closes one controlled encoded-file → browser decoder → native capture → analysis/export check. It is not a natural-video corpus or a replacement for the dense-throughput failure above.

The immutable [source manifest](../tests/extension/fixtures/native-encoded/manifest.json) and [preparation script](../tests/extension/prepare-native-encoded.mjs) define two 2 × 2-pixel, 25 fps, lossless sources without audio. The signal has 52 frames covering 2.08 seconds of grey35/125 alternation plus a final grey35 frame; the fixed source stays grey35. Every decoded RGBA byte and integer PTS was checked before capture. The signal file is **3,281 bytes**, SHA-256 `03bf0717f3b337b11a91c92f7caa31337a38d0644b795a8ae7e3ea4e74240092`; manifest SHA-256 is `c6ffd34d863227489ea8bcd3924cc5e520f9e67ca11bac05a3f9f2c076acb73c`.

The [independent browser preflight](../tests/extension/evidence/scanner-v04-encoded-video-preflight.json) reads actual 2 × 2 video pixels into a detached canvas on each presentation callback. Chrome presents 52/53 sampled frames for the signal/fixed sources, with every sampled RGB byte equal to the offline decoder reference. It confirms `srcObject: null`, the real encoded URL, a 2 × 2 CSS rectangle, a grey35 poster, and no playback before the disclosure action. This check runs in CI separately from native capture. Preparation refuses an existing output directory; retained media and manifests must not be overwritten to improve a later result.

The [native report](../tests/extension/evidence/scanner-v04-native-encoded-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-encoded-local-job.json), [environment](../tests/extension/evidence/scanner-v04-native-encoded-environment.json) and [verification](../tests/extension/evidence/scanner-v04-native-encoded-verification.json) retain the real toolbar-started signal scan on source build **`e4f04fb5…`** and ordinary artifact **`a0b52ff6…`**, matching the exact source fingerprint and artifact bytes retained for that run. No offscreen pixel-probe instrumentation is used in this run.

| Triggered observation | Native pixels | Frames | Effective cadence | Maximum gap | Mean / maximum worker time |
| --------------------- | ------------: | -----: | ----------------: | ----------: | -------------------------: |
| Desktop               |   1800 × 1126 |    306 |       59.9921 fps |     18.0 ms |             8.19 / 31.4 ms |
| Compact               |   1200 × 1126 |    306 |       59.9933 fps |     18.0 ms |             6.68 / 22.0 ms |

Both triggered observations have adequate capture, no reported skips or rescaling, and the exact **4 × 4 source-pixel candidate at x=200, y=480**. Retained diagnostic samples match grey35 and grey125 with **zero channel error**. Both retain `W3C_CSS_REFERENCE`, **682 × 512** pixels and a 16-pixel maximum. **18 compact-document presentation records** exactly match independent media times, presentation epochs and expected display epochs. Capture-to-DOM latency is still unknown; this is temporal correlation, not general causal attribution.

The action observations are `NEEDS_REVIEW`. The whole autonomous job remains `PARTIAL` / `INCONCLUSIVE`, with `passed: null`, because unsupported hover, transitions and additional compact states are explicitly untested. The verifier's **`PASS` means this fixture contract passed**, not that the site, video or user is safe or WCAG conformant. Only this Mac, Chrome configuration and tiny encoded signal are covered.

```sh
EPI_LESS_FIXTURE_ENCODED=1 node tests/extension/native-fixture.mjs
node tests/extension/verify-native-encoded.mjs path/to/local-job.json path/to/environment.json
# Standalone actual-browser decoder check; no tab capture:
node tests/extension/preflight-native-encoded.mjs
```

The verifier checks source identity, exact candidate geometry, reference mapping, native RGB tolerance, capture adequacy and matching compact presentation records. Inadequate capture produces retained `FAIL` JSON and exit code 2; it is not silently accepted.

## CSS reference: retained sparse-video success

The current worker uses **`W3C_CSS_REFERENCE`**, following [W3C Understanding SC 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html): a **341 × 256 CSS-pixel** field at standard browser zoom and visual-viewport scale, mapped to native source pixels through verified DPR. At DPR 2 that is **682 × 512 source pixels**, not 341 × 256. Source dimensions must match the measured CSS viewport × DPR; fractional field extents are rounded to the nearest source pixel. This is a conditional reference comparison, not physical display calibration or a WCAG verdict.

Missing/mismatched mapping or nonstandard zoom prevents attaching the CSS field. After measurement, changed or unavailable document/viewport/zoom context removes it with an explicit limitation. Revision counters also detect a resize or zoom that changed and returned to its initial value during capture; ordinary scrolling with stable mapping is allowed. These reference guards preserve pixel candidates and exact mask counts. They do not relax the separate native-frame geometry/continuity gate, and rescaled measurements remain inconclusive.

The [mapping tests](../tests/extension/reference-field.test.ts), [context-guard tests](../tests/extension/reference-context.test.ts) and [worker fixture](../tests/extension/worker-capture.mjs) cover this contract separately from native capture. The native run below verifies the field on its recorded build on one sparse video fixture. The `3be52f9f…` video and workspace records further below remain unchanged historical evidence; their old source-pixel fields and timings are not relabelled.

The [CSS-video capture report](../tests/extension/evidence/scanner-v04-native-css-video-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-css-video-local-job.json) and [environment](../tests/extension/evidence/scanner-v04-native-css-video-environment.json) retain source build **`3460e19c85f5b1c56eaf97d2201f91ba2da5c6f4fc6e6502188c62c7002c5121`** and ordinary artifact **`f63f4c4a2482eb28807dffa1adc4cc1becfbfcabc004085a1d19a1cee9f01d6f`**, with engine source `4a757855…`. The actual toolbar authorizes the autonomous scan in headed Chrome for Testing **156.0.8078.4** on an Apple M2 Max Mac. A supported disclosure triggers a **2 × 2 CSS-pixel HTML video** supplied by a detached `canvas.captureStream(60)` source. This is actual video-element presentation and native tab capture, not encoded-file playback or injected analysis frames.

| Triggered observation | Native pixels | Frames | Effective cadence | Maximum gap | Mean / maximum worker time |
| --------------------- | ------------: | -----: | ----------------: | ----------: | -------------------------: |
| Desktop               |   1800 × 1126 |    306 |       59.9886 fps |     17.8 ms |             8.15 / 31.8 ms |
| Compact               |   1200 × 1126 |    306 |       60.0063 fps |     17.9 ms |             6.12 / 20.1 ms |

Both observations retain the exact **4 × 4 source-pixel candidate at x=200, y=480**, without reported interruption or rescaling. Both exports retain **`W3C_CSS_REFERENCE`, 682 × 512 source pixels**, a 16-pixel maximum and the below-threshold candidate. Source dimensions agree with the respective **900 × 563** and **600 × 563 CSS-pixel** viewports at DPR 2. This proves that recorded build’s capture/worker/reference/export path on the measured fixture. There is no corner-pixel probe in this run and no physical colour-calibration claim.

The [verification artifact](../tests/extension/evidence/scanner-v04-native-css-video-verification.json) records **21 compact-document rVFC presentations** that exactly match independent page-side media times, presentation epochs and expected display epochs. The final page record belongs to the compact document after navigation, so it does not independently verify the replaced desktop document's presentation timing. Source-to-DOM latency remains unknown; matching metadata is correlation, not a generally proven causal source.

All **seven measured segments** meet the local capture-quality gate. The job remains **`PARTIAL` / `INCONCLUSIVE`**, with genuine hover, resize/source transitions and additional compact states explicitly skipped. The recorded visible page returns to its original 900 × 563 CSS viewport and 900 × 650 outer window. This is not a repeat of advanced inactive-workspace restoration, a broad video/codec evaluation or a hardware matrix. Native zoom/resize guard rejection and sustained complex-content throughput remain separate validation boundaries.

## Scanner 0.4: retained initial capture failures

Both runs used headed Chrome for Testing **156.0.8078.4** on macOS and the actual extension toolbar. The fixture contained static content and only a tiny, slowly moving, low-contrast marker; no flashing media were displayed. Both were 15-second current-viewport observations, with engine `0.4.0-candidate`, runner `0.4.0`, `PARTIAL` / `INCONCLUSIVE` and `passed: null`.

| Measurement                          | Initial 0.4 run | Physical-window repeat |
| ------------------------------------ | --------------: | ---------------------: |
| Analysed frames                      |              96 |                    433 |
| Effective analysis cadence           |        6.36 fps |              28.83 fps |
| Largest gap                          |        262.4 ms |               200.6 ms |
| Source frames skipped or unavailable |             800 |                    468 |
| Decoded source size                  |     6720 × 3780 |            6720 × 3780 |
| Analysed size                        |     1920 × 1080 |            1920 × 1080 |
| Retained source pixel-count ratio    |           8.16% |                  8.16% |
| Mean worker conversion + analysis    |       148.89 ms |               22.22 ms |
| Largest worker processing time       |        231.4 ms |               180.4 ms |

The [initial report](../tests/extension/evidence/scanner-v04-initial-capture.json) and [initial environment/build record](../tests/extension/evidence/scanner-v04-initial-environment.json) retain build SHA-256 `27863be33776031e995c6839ad1cf8ea1436342e0ee4dfad4d65bea3f27bea5f`. Other browser and FFV1 validation jobs ran concurrently. This is an observed failure under that load, not an isolated performance benchmark or a proven explanation of the bottleneck.

The [physical-window report](../tests/extension/evidence/scanner-v04-physical-initial-capture.json) and [physical-window environment](../tests/extension/evidence/scanner-v04-physical-initial-environment.json) retain build `cc379c6f517eb6ff7807382ad7a20f4b57f7616a1af2b53d9e48d111aaa67e51`. This run used an Apple M2 Max, arm64, macOS kernel 25.4.0 and a requested 900 × 650 browser window without viewport emulation. Mean conversion was **17.12 ms** and analysis **5.09 ms**; all 433 measured frames exceeded 16.7 ms of worker processing. The track advertised 60 fps, which clearly did not establish 60 analysed fps.

Geometry is inconsistent in these two initial records. The physical run's environment reports a **900 × 563 CSS viewport at DPR 2**, while its report records **DPR 4**. Its 6720 × 3780 decoded stream equals the recorded 3360 × 1890 screen dimensions multiplied by two, but that numerical correspondence does not prove the cause or validate which page pixels were sampled. The first run also differs from its emulated viewport. Both rescale the source and lack reliable temporal coverage; zero findings do not establish safety. The later geometry run below supplies separate evidence; these exports remain unchanged.

The reported approximately 189.5 MB `stateBytes` is an engine-state bound within the 256 MiB budget, not measured total browser RAM. Decoded input, conversion surfaces and GPU buffers are outside that figure. Full pipeline resource use still needs measurement.

## Scanner 0.4: negotiated geometry probe

A later [native geometry report](../tests/extension/evidence/scanner-v04-native-geometry-capture.json) and [environment/probe record](../tests/extension/evidence/scanner-v04-native-geometry-environment.json) retain a different build: `1bd8a0daa5549f92d1972b7f4cdfd1e60c3966c7892b368535b28be4c3b2a44f`. Explicit capture negotiation produced **1800 × 1126 decoded pixels**, matching the **900 × 563 CSS viewport at DPR 2** in both the environment and report. All source pixels were analysed; no resizing was applied.

The run analysed **890 frames at 59.33 fps**, with mean worker time **6.41 ms** (conversion **3.99 ms**, analysis **2.41 ms**), maximum **84.4 ms** and two frames above 16.7 ms. Conversion used `VIDEOFRAME_COPY_RGBA`. The largest capture gap was **116.9 ms** and **10 source/analysis frames were skipped or unavailable**, so the report remains `PARTIAL` / `INCONCLUSIVE`, `passed: null`.

A temporary copy of the offscreen bundle sampled four fixed, non-flashing corner colours once per source geometry. All four matched their expected channel values within **2/255**, supporting correct orientation and no edge letterboxing at those sampled points. The probe stores only numeric values, coordinates and timing; no captured frame images are retained. It is not a full-image comparison or a colour-calibration test. The environment records the copied fixture bundle's separate hash, `4cf0513d3a03c74556dbf76c572b8bc1d6c5ec89196d304967f28f856496bc97`, and its added first-frame overhead. The production `dist` was unchanged by the probe.

This result establishes useful local progress in capture geometry and processing speed. It does not replace an uninstrumented native repeat, adequate continuity, or the missing hardware/OS/Chrome/DPR matrix.

## Scanner 0.4: uninstrumented production-build repeat

The [production-build report](../tests/extension/evidence/scanner-v04-native-production-capture.json) and [environment](../tests/extension/evidence/scanner-v04-native-production-environment.json) retain build `d59b703ed81b0988d63b19355cf2b175e425901a0954761b5650b3d7056bfdf0`. This repeat used the ordinary built extension without a pixel probe, on the same physical 900 × 563 CSS viewport at DPR 2. It analysed all **1800 × 1126 source pixels**, with **897 frames at 59.80 fps**. Mean worker time was **7.68 ms** (conversion **3.96 ms**, analysis **3.71 ms**); the maximum was **32.1 ms** and the largest source-frame gap **33.5 ms**.

Three source/analysis frames were skipped or unavailable. The report therefore retains `interrupted: true`, `INCONCLUSIVE` and `passed: null`, despite the high average cadence and lack of rescaling. This is improved production-build evidence, not a reason to relax the capture-quality gate. It remains separate from the instrumented geometry proof and from later queue/backpressure changes.

## Scanner 0.4: bounded FIFO, first adequate native fixture

The [FIFO production report](../tests/extension/evidence/scanner-v04-native-fifo-capture.json) and [environment](../tests/extension/evidence/scanner-v04-native-fifo-environment.json) retain ordinary build `d4b3280d3af44bb4612493520fadba4ba33e3a8a183bfc8d0d83766c14f28e00`. A bounded queue keeps at most three genuine source frames in flight, processes them in order and preserves their timestamps. This allows the worker to recover from a short processing spike; sustained overload still loses frames explicitly. No repeated/synthetic frames, pixel probes or relaxed quality thresholds were used.

This real toolbar-authorised 15-second observation retained **900 frames at 59.998 fps**, maximum source-frame gap **17.8 ms**, at **1800 × 1126 native resolution**. There were **no reported skips or downsampling**, and `interrupted` is false. Mean worker time was **7.81 ms** (conversion **3.95 ms**, analysis **3.85 ms**), maximum **31.5 ms**. The outcome is `COMPLETED` / `NO_ISSUES_OBSERVED`, with **`passed: null`**. The engine source is unchanged from the retained `b912…` benchmark and final external regression checks.

This is the first retained native 0.4 result that meets the current local capture-quality gate. Its boundary is one mostly static fixture with a tiny, slowly moving marker on an Apple M2 Max, Chrome for Testing 156 and a 900 × 563 CSS viewport at DPR 2. A separate short viewport-restoration fixture overlapped approximately the final four seconds; this is an observed local run, not an isolated hardware benchmark. It does not validate complex changing content, other displays/OS versions, colour calibration or site-wide safety. The earlier engine-only fully changing 1080p gradient measurement averaged about 45 ms per frame; see [scanner quality](SCANNER-QUALITY.md).

## Historical advanced native run: compact profile unreached

The [advanced-toolbar report](../tests/extension/evidence/scanner-v04-native-advanced-capture.json) and [environment record](../tests/extension/evidence/scanner-v04-native-advanced-environment.json) retain an instrumented fixture build with a numeric collector and corner probe, separately fingerprinted from the production build. It measured the original **1800 × 1014** native viewport (900 × 507 CSS pixels at DPR 2) and supported hover, focus, control and delayed-state observations. **Compact coverage is recorded twice as `UNREACHED`**, with `OverconstrainedError: Cannot satisfy constraints`; these entries do not prove two independent attempts. Compact CSS layout was reached, but applying capture constraints failed and no compact measurement was retained. The overall run remains partial. Later fresh-source and physical-workspace observations below are separate evidence; they do not change this failed run.

Separate headed macOS/DPR 2 and headless Chrome driver checks did confirm inactive-tab CSS layout, a responsive control, real hover, restoration and debugger detach. Those checks remain useful but are not capture validation. At this checkpoint, native compact/responsive capture remained open; it could not inherit the ordinary viewport's positive result.

## Historical advanced native restart: cadence reached, mapping/restoration failed

The [restart report](../tests/extension/evidence/scanner-v04-native-advanced-restart-capture.json) and [environment](../tests/extension/evidence/scanner-v04-native-advanced-restart-environment.json) preserve the next actual toolbar run. Stopping the old producer and acquiring a fresh one-use tab token succeeds without another toolbar gesture. Compact viewport and control observations retain **300 and 306 frames**, approximately **60 fps**, at **1200 × 1014**, corresponding to 600 × 507 CSS pixels at DPR 2, with `resizeMode: none`, no downsampling or reported interruption. Original-viewport observations also meet the local cadence gate.

This is **not accepted compact image validation**. The first frame at the compact geometry has four black corner samples, whereas the original geometry matches its four static markers within 4/255. A first-frame transient and persistent rendering/mapping failure are not yet distinguished. The overall job ends `INTERRUPTED` with `CDP_VIEWPORT_RESTORE_UNCONFIRMED`; final geometry is 900 × 507 at DPR 2 and the debugger is detached, but the target is foregrounded. Subsequent probes must examine later compact frames and verify restoration in the relevant browser UI context. These observed failures remain separate from later fixes.

## Advanced lifecycle repeat: persistent compact image-mapping failure

The [lifecycle report](../tests/extension/evidence/scanner-v04-native-advanced-lifecycle-capture.json) and [environment](../tests/extension/evidence/scanner-v04-native-advanced-lifecycle-environment.json) record the next production build `79cb6993258ffe8b62ba25ca5da2c2326080bc612a9cbeb1fa264f04290045e6`, with separate probe instrumentation. Attaching the debugger before the first source establishes consistent 900 × 450 CSS geometry at DPR 2. Releasing the old producer before resize and checking stable restoration removes the earlier `CDP_VIEWPORT_RESTORE_UNCONFIRMED` result. The final CSS viewport is 900 × 507 after the debugger notice disappears; outer window is 900 × 650 and debugger detached. The target is active at collection, so this is not proof of preserving the foreground dashboard.

Compact observations retain **300 and 306 frames** at approximately 60 fps, **1200 × 900 native pixels**, with no reported skips, rescaling or interruption. But **all four numeric corners are black on compact frames 1, 30 and 120**, while all original-viewport probes match their expected markers within 4/255. This rules out an explanation limited to the first compact frame. Correct dimensions and cadence therefore do not establish correct page pixels. The overall job is `PARTIAL`, with explicit skipped transition/additional-state observations. The compact image-mapping gate remains open; this retained output must not be relabelled as accepted coverage after a later driver change.

## Native tiny detail, targeted fix and recurrence

A real toolbar-authorized ordinary-build scan detects a **2 × 2 CSS-pixel** marker as exactly **4 × 4 source pixels** within an **1800 × 1126** frame. A supported disclosure action triggers about two seconds of colour changes only on that marker. The remaining page is static apart from a tiny, low-contrast slow-motion cadence marker; no large flashing surface or audio is used. The scanner acts autonomously after the toolbar start.

| Actual observation                                                                               | Frames | Effective fps | Outcome for the same candidate |
| ------------------------------------------------------------------------------------------------ | -----: | ------------: | ------------------------------ |
| [Original detail](../tests/extension/evidence/scanner-v04-native-detail-capture.json)            |    307 |        59.994 | GENERAL_FLASH candidate        |
| [Colour change removed](../tests/extension/evidence/scanner-v04-native-fixed-capture.json)       |    307 |        60.001 | NOT_OBSERVED                   |
| [Colour change restored](../tests/extension/evidence/scanner-v04-native-recurrence-capture.json) |    306 |        59.984 | REOBSERVED                     |

All three matched action observations retain every source pixel, no reported skipped frames or interruption, and maximum gaps below 100 ms. The [verification artifact](../tests/extension/evidence/scanner-v04-native-recheck-verification.json) records the actual job/anchor IDs and identical cold-build source fingerprint `fea8073dd5f05b2a36164962cb1428627578d324fb8cc9385c058b18bbfbc753`; the detector is engine source `4622…`. Run `node --import tsx tests/extension/verify-native-recheck.mjs` with the retained detail, fixed and recurrence `-local-job.json` files to check the comparison and capture requirements again. These observations precede later viewport-lifecycle fixes; they do not silently validate changed source.

The original event retains all 16 affected pixels, its numeric colour trace, the actual 2 × 2 CSS rectangle and running `backgroundColor` animation in during-event samples. Its frame receipt alignment matches 30 source frames with zero boundary mismatch and about 0.40 ms receipt-offset spread. That spread is not capture-to-DOM latency, which remains unknown. The accompanying environment files retain fixture action/animation/colour-change timestamps as independent page-side evidence. This is temporal/spatial correlation, not atomic causal attribution.

The [persisted review evidence](../tests/extension/evidence/scanner-v04-native-review-verification.json) records actual extension runtime commands from the local fixture dashboard and the resulting IndexedDB events: `CONFIRMED → RESOLVED → REOPENED`. Resolution before confirmation is refused; reusing the older negative scan after reopening is also refused. These exercise real background validation and storage, not clicks on the review buttons. All three capture starts use the actual toolbar.

The subsequent [real dashboard UI verification](../tests/extension/evidence/scanner-v04-review-ui-verification.json) runs **two separate UI-transition tests** over those retained native jobs in headless Chrome. Phase A clicks confirmation and resolution, then verifies that the historical recurrence is too old to reopen this new resolution. Phase B restores the original historical confirmation/resolution prefix, clicks reopening with the later historical recurrence, and verifies that the stale negative resolution button is disabled. Actual review events are persisted, while capture payloads, timestamps and hashes stay unchanged. The test creates **zero new capture jobs** and is not a new continuous end-to-end capture/review lifecycle.

The complete original autonomous job remains `PARTIAL` because its physical compact resize was not reached. Both targeted jobs are `COMPLETED`. Neither this tiny candidate nor its absence establishes an area-threshold violation, general conformance or safety. This is one browser and one Apple M2 Max; a second physical computer is not currently available.

## Physical workspace: accepted compact pixels, partial whole job

The [physical-workspace report](../tests/extension/evidence/scanner-v04-native-workspace-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-workspace-local-job.json) and [environment](../tests/extension/evidence/scanner-v04-native-workspace-environment.json) retain source build `3be52f9f550fd43e528459133bc147a3b28130f22ef563f303b6a46327ddd640`. The production advanced artifact is `5dfec6c8cf8863b583e15285e25fbe42ad4ec52ba692d838e6860113d373fd6c`; the fixture separately fingerprints its copied collector/probe instrumentation. No Playwright/CDP client attaches to this browser; the real toolbar authorizes capture and the extension owns the hover debugger.

The replacement **PHYSICAL** compact viewport and responsive disclosure retain **300 and 307 frames**, respectively, at approximately **59.99 fps**, **1200 × 900 native pixels**, with maximum gaps below 18 ms, no reported interruption and no rescaling. All four known corner colours match within **4/255 per channel on frames 1, 30 and 120**, at both original and compact geometry. This passes the specific compact mapping/cadence gate that the earlier CDP route failed **on source build `3be52f9f…`**. It does not accept the later CSS-reference build. The [reproducible verification](../tests/extension/evidence/scanner-v04-native-workspace-verification.json) is produced by `verify-native-workspace.mjs` using the retained local-job and environment files.

The one-second focus samples show an active target inside an **unfocused** workspace, followed by an inactive target back in the same original focused window, with the same active dashboard tab before and after. The original outer window remains 900 × 650 and the debugger is detached. Those samples do not prove the absence of every brief focus event; the separate headless/headful helper checks actual activation/focus events. After detach the hidden target still reports **900 × 450 CSS pixels**, matching the debugger-attached measurement baseline. Pre-start geometry was **900 × 507**; immediate restoration to that pre-notice CSS height while hidden is **not claimed**.

The whole job remains **PARTIAL / INCONCLUSIVE**: its initial desktop observation records **two skipped/unavailable frames**, while source/viewport transitions and additional compact states are explicitly skipped. A successful compact segment does not erase those gaps. Older black-corner failures remain unchanged; CDP compact capture and replay are now refused. A session lease supports restoration after a worker restart. The small create-window-to-persist crash gap has an earlier move intent and a local manual-restore notice, without guessed ownership or blind tab movement.

## Native HTML video and connected reference-area assessment

The [native video report](../tests/extension/evidence/scanner-v04-native-video-capture.json), [local job](../tests/extension/evidence/scanner-v04-native-video-local-job.json) and [page/environment record](../tests/extension/evidence/scanner-v04-native-video-environment.json) use the same source build `3be52f9f…`, ordinary artifact `f763a800c7eb1e4a809950e412a6c3dfa9ebd056e34e58327228e65cf980bc83`. A real, muted **2 × 2 CSS-pixel HTML video** presents a detached `canvas.captureStream(60)` source. Its grey values alternate only for 2.08 seconds after a supported disclosure; the canvas itself is never displayed. This is real video-element presentation and native capture, **not encoded-file playback**.

| Triggered observation | Native pixels | Frames | Effective cadence | Maximum gap | Mean worker time |
| --------------------- | ------------: | -----: | ----------------: | ----------: | ---------------: |
| Original profile      |   1800 × 1126 |    306 |        59.993 fps |     18.9 ms |          8.27 ms |
| Compact profile       |   1200 × 1126 |    306 |        60.005 fps |     17.8 ms |          6.20 ms |

Both retain the exact **4 × 4 source-pixel candidate** at x=200, y=480, without reported interruption or rescaling. During-event samples identify the actual video at x=100, y=240, 2 × 2 CSS pixels. In the compact document, **22 presented-frame records** agree exactly with independently recorded page-side `requestVideoFrameCallback` media times, presentation epochs and expected display epochs. The fixture records source-canvas draws separately; it does not pretend a draw timestamp identifies the already presented frame. The [verification result](../tests/extension/evidence/scanner-v04-native-video-verification.json), reproducible with `verify-native-video.mjs`, preserves this boundary. The desktop document was replaced during compact navigation; the final page-side record independently checks the compact document only.

That build's **341 × 256 source-pixel reference field**, labelled `W3C_1024_768_REFERENCE`, survives the actual exported report: maximum simultaneous area is 16 pixels, below its reference threshold, and the candidate remains visible. Its label explicitly states the assumed display geometry and unknown real viewing conditions. No local inspection token appears in the report export. This connects capture → worker → that earlier reference evidence → local export on **`3be52f9f…`**. It neither validates physical calibration nor the later 341 × 256 **CSS-pixel** reference, which would map to 682 × 512 source pixels at this DPR. The original JSON and ratios are preserved.

All measured segments in this video job meet the local cadence/continuity gate; the job is still **PARTIAL** because genuine hover, transitions and additional compact states are explicitly untested. Worker maxima are 32.1 ms and 19.5 ms for the two triggered observations; brief spikes are absorbed by the bounded queue on this fixture. This does not establish sustained complex-video throughput. Capture-to-DOM latency remains unknown: exact video presentation metadata is not a general causal-attribution or physical-latency guarantee. Only this Mac was tested.

## Scanner 0.4: separate automated evidence

The preceding CSS-reference checkpoint passed **315 unit/integration tests**, including **60 engine tests**, all typechecks, the web build, two focused diagnostic/privacy web tests and the complete extension browser chain. The original 42-case temporal, expanded 398-case temporal and full 24-mask/36-video gates pass on engine `4a757855…`, preserving known disagreements. These checks are distinct from the native CSS-video run and from earlier build-specific evidence below.

- **Temporal DOM fixtures** exercise sampled geometry, changing/replaced elements, scroll offsets, animation/video metadata, missing/stale observations and original-node inspection guards in isolated Chrome. Alignment uses an estimated source-frame receipt clock; unknown compositor latency is explicit. These checks do not prove frame-atomic DOM attribution at a native captured flash.
- **Scenario/recheck fixtures** exercise bounded carousel/focus/hover states, replay recipes, viewport restoration, cancellation and refusal to compare incompatible or inadequately captured scans. Genuine hover uses browser input in the opt-in advanced build. These fixtures are separate from a real toolbar-authorised autonomous run across a hardware matrix.
- **External decoded media** uses 24 original masks and 36 source video configurations. The validator creates actual lossless FFV1 files and checks all **1,204 decoded frame hashes and timestamps** before analysis; nothing is played. This tests file encoding/decoding and the engine, not Chrome `tabCapture`. The [source matrix, contradictions and method](../tests/reference/trace-spatial/README.md) retain all disagreements.
- **Expanded numeric references** score 398 patterns: 129 TP, 0 FN, 18 FP and 251 TN against upstream labels, plus two malformed unscored originals. These are not adjudicated accuracy figures and do not exercise a browser or display. The [numeric disagreement review](DETECTION-DISAGREEMENTS.md) supplies reproducible traces: staircase excursions clear the temporal thresholds, official W3C guidance supports the seven transitions preceding `dr011`'s weak eighth return, and `s014` retains a transition-duration ambiguity. Labels and baseline statistics remain unchanged; external adjudication is still open.

## Historical P0 environment and fixture

- Chrome for Testing **156.0.8078.4**, headed Chromium, macOS.
- An isolated temporary browser profile loaded the unpacked extension.
- The cadence fixture served four same-origin routes: `/`, `/about`, `/guide` and `/sitemap-only`. The last route appeared only in `/sitemap.xml`, referenced by `/robots.txt`. Each route contained static content, a scrollable page and an ARIA disclosure. A forbidden `/logout` link exercised the route policy.
- For cadence measurement, a **4 × 4 pixel** marker moved slowly over 200 pixels in 20 seconds. Its colour was `#e8e8e8` against `#eee`. The fixture contained no flashing or audio. The default fixture has no animation at all.
- The scan started through the actual browser extension toolbar. The quiet dashboard was foregrounded while the captured website stayed in another tab. DevTools was closed.

An initial optional-origin permission grant closed Chrome's popup. The persisted start intent correctly continued the scan without a second start click. Popup lifetime therefore did not own the scan.

## Observed results

| Run                                 | Observations                                 | Analysed cadence                       | Report outcome             |
| ----------------------------------- | -------------------------------------------- | -------------------------------------- | -------------------------- |
| Earlier 640 × 360 analysis budget   | Three routes, nine scenarios                 | 29.73–30.02 fps                        | `PARTIAL` / `INCONCLUSIVE` |
| Optimised 320 × 180 analysis budget | One 15-second viewport scenario; 888 frames  | 59.1065 fps; maximum gap 75.5 ms       | `PARTIAL` / `INCONCLUSIVE` |
| Four-route cadence capture          | Four routes, sixteen scenarios; 5,932 frames | 51.133–60.009 fps; maximum gap 64.1 ms | `PARTIAL` / `INCONCLUSIVE` |

The cadence run observed navigation transition, initial viewport, scroll and disclosure scenarios on each of the four routes. Capture started before each navigation; transition observations preserve the source/destination context instead of attributing all frames to the destination. The runner found `/sitemap-only` without the user opening it. Server request logging included all four routes, `/robots.txt`, `/sitemap.xml` and `/favicon.ico`, with **no `/logout` request**.

All runs downsampled the source. Those limitations remain visible in the reports even when the average cadence exceeds 50 fps. All reports have `passed: null`. Completing the route plan does not imply complete measurement coverage or a safety verdict; zero candidate findings on these synthetic pages does not establish safety.

The [four-route report](../tests/extension/evidence/p0-four-routes.json) and [environment/build record](../tests/extension/evidence/p0-environment.json) are retained as synthetic evidence. Core capture and viewport metadata were current at capture time. Subsequent robots-path, history-selection and autonomous-navigation changes are outside that build fingerprint; this cadence evidence does not claim a rerun on those later changes. Earlier [three-route](../tests/extension/evidence/background-three-routes.json) and [viewport](../tests/extension/evidence/background-viewport-optimized.json) exports remain available. No browser profiles, account details or transfer tokens are included.

An earlier entirely static fixture produced few frames. The offscreen video compositor also provided no useful `requestVideoFrameCallback` delivery in that configuration. The implementation prefers `MediaStreamTrackProcessor` and actual `VideoFrame.timestamp` values, retaining the video callback as a fallback. Sparse capture is reported as insufficient evidence, never converted into an assumed 60 fps stream.

## Local P0 interactive autonomy check

The final local P0 extension build was started from the real toolbar on the same browser/OS, with its dashboard foregrounded and publication origin `http://localhost:4387`. It completed **five canonical routes and 22 scenarios** without further input, ending with `QUEUE_EXHAUSTED`. All five routes have exactly one initial-viewport observation.

- The home page's known consent rejection, five bounded scroll observations, menu, nested tab, muted video and both carousel controls were exercised. The video was a non-flashing grey canvas stream with no audio.
- The sitemap-only route was discovered and visited automatically.
- Two redirect links were each requested once and reached the same canonical route. Both navigation transitions remain in that route's report, with one viewport scan and no duplicate route.
- A link inserted only after scrolling was rediscovered after returning to its source page and its destination `/lazy-observed` was requested and observed.
- A home-menu-only `/spa/client` link was reached through the actual rendered link and `pushState`, after restoring its discovery source. The fixture returns 404 for a direct document request to that route; **no such request occurred**.
- No `/logout` request occurred. The unsupported hash route is recorded as a coverage limitation, and its test fragment is absent from the exported report. There were no navigation timeout or missing-discovered-link limitations.

The [interactive report](../tests/extension/evidence/p0-interactive.json) and [environment, exact build fingerprint and request counts](../tests/extension/evidence/p0-interactive-environment.json) retain this evidence. The run analysed **544 frames**; the video observation measured about **19.93 fps**, while entirely static observations had few or zero delivered frames. This test proves bounded autonomous navigation and supported actions on the fixture, not cadence adequacy or site safety. Its outcome remains `PARTIAL` / `INCONCLUSIVE`, with `passed: null`, downsampling and insufficient sampling explicitly preserved. It is separate from the earlier four-route cadence measurement. The disposable browser profile and temporary capture files were removed after retaining only synthetic JSON evidence.

## Scanner 0.2 native repeat

After the [scanner quality improvements](SCANNER-QUALITY.md), the final build was exercised again through the actual toolbar on the same browser/OS and non-flashing interactive fixture. The [new report](../tests/extension/evidence/scanner-v02-interactive.json) records engine `0.2.0-candidate`, runner `0.2.0`, **five routes, 22 scenarios and 543 analysed frames**, ending with `QUEUE_EXHAUSTED`. The [environment/build fingerprint and request counts](../tests/extension/evidence/scanner-v02-environment.json) preserve the exact boundary.

All five routes retained one viewport observation; both redirect aliases were requested once; lazy-source restoration and real-link SPA navigation succeeded; there was no logout or direct SPA document request. Every scenario now includes `captureWindowMs`, `leadingIdleMs` and `trailingIdleMs`. The visible dashboard confirmed the distinction between a 15-second static observation with zero analysed frames and a navigation interval with one frame followed by silence. The media observation measured about 19.89 fps. The result remains `PARTIAL` / `INCONCLUSIVE`, `passed: null`; completing navigation does not prove sampling adequacy. Nested open-shadow controls and overlay boundaries have separate real-browser DOM fixtures, not native capture evidence in this fixture. The isolated profile was removed after retaining the synthetic JSON.

## Scanner 0.3 diagnostic pipeline boundary

The 0.3 build has new automated Chrome evidence for actual engine output on **unrendered numeric pixel arrays**: strict report validation, IndexedDB persistence, visible static SVG and exact RGB sample tables, JSON/offline HTML/history exports, pseudonymized removal and the frozen tab-bound transfer. Separate real-DOM tests cover read-only spatial hints, nested open shadow paths (including ambiguous CSS-selector counterexamples), media/animation descriptors, bounded work and document/viewport/scroll/zoom mismatch rejection. Public browser tests prove diagnostic opt-in/omission survives publication and JSON/HTML downloads, with no-JavaScript reading, 320px reflow and accessible open details.

These checks do **not** replace native tabcapture or prove DOM causality at a captured flash. At the 0.3 checkpoint, the latest retained toolbar-started native capture was the 0.2 report above; it was not relabelled as a 0.3 capture. The separate 0.4 native runs are recorded at the top of this document. The independent 42-case numeric comparison and its two unresolved disagreements are in [SCANNER-QUALITY](SCANNER-QUALITY.md).

## Local publication integration

The earlier three-route report was transferred from the extension to a local production web preview at `http://localhost:4387`. An unauthenticated attempt requested sign-in. After signing in with a disposable local test account, reopening the extension's preview transferred the frozen report successfully. The page removed the nonce fragment, displayed the actual scope and findings, and required explicit visibility selection and confirmation.

An explicit public publication then succeeded. Its resulting report page displayed three visited routes, nine scenarios and the original partial/inconclusive outcome with capture limitations. The current public-index policy rejects new public publications of loopback/private origins; use private/unlisted visibility for local fixture origins, or import a synthetic public-origin report to exercise public sharing. This was a local integration test, not a deployed public service or production Turnstile test.

Separate automated browser checks verify wrong-tab rejection, a successful exact-origin transfer, nonce replay rejection and retention of the selected snapshot after the underlying job changes. The web suite exercises privacy selection, restart-persistent approved uploads, account changes, lost commit responses, cancellation and withdrawal. The extension never publishes automatically.

## Reproduce

Use the repository's pinned Node and pnpm versions, install dependencies and install Playwright Chromium. From the repository root:

```sh
pnpm --filter @epi-less/chrome-extension build
EPI_LESS_FIXTURE_MOTION=1 node tests/extension/native-fixture.mjs
```

For the interactive five-route check, use `EPI_LESS_FIXTURE_INTERACTIVE=1 node tests/extension/native-fixture.mjs` instead. This selects a separate mostly static fixture; the motion flag does not add the cadence marker to it.

In the isolated browser, open the epi-less toolbar, start the scan and grant access to the local fixture origin. Leave the dashboard foregrounded. For the short cadence check, select the current-viewport-only option before starting. The script writes exported reports and environment/request logs to its printed temporary evidence directory. Ctrl+C closes only this fixture browser and server. Do not commit the temporary browser profile.

For publication integration, start the local web app and build the extension with its exact origin, for example:

```sh
EPI_LESS_WEB_URL=http://localhost:4387 pnpm --filter @epi-less/chrome-extension build
```

Reload the extension after rebuilding. Create a disposable local account, select a completed report, open its hosted preview and explicitly choose whether to publish it.

Automated checks, which do not replace native capture authorisation:

```sh
pnpm exec vitest run tests/extension/runner.test.ts tests/extension/p0.test.ts
EPI_LESS_WEB_URL=http://localhost:4387 pnpm --filter @epi-less/chrome-extension test:browser
```

The browser suite must use the same local origin as the extension build. It starts its own bridge fixture on that port, so stop the app preview first. It covers durable stop/restart, JSON/HTML export, versioned local history and retention, the hosted bridge, form-associated submit controls outside forms, forbidden target subtrees, mutations during scrolling and cancellation before a deferred click.

## Remaining validation boundaries

- Extend the accepted current `6770f520…` / `c216fbe2…` dense and encoded repeats to broader changing-content workloads. They close the specific earlier cadence gap for the recorded fixture; the compact dense gap of 33.4 ms remains explicit, and no general 60 fps claim follows. Preserve pixel/source candidates and inconclusive outcomes when quality is inadequate. The separate positive dense/encoded observations still flag `MEDIA_REPLAY_NOT_REPRODUCIBLE`. The new stable-locator desktop variant proves one comparable fix/recurrence sequence; broader replay coverage still needs its own evidence. Extend the `W3C_CSS_REFERENCE` result beyond the current desktop/compact fixtures. Repeat native rejection of changed zoom/viewport context and fix advanced cancellation restoration: resources are released, but final CSS height remains 450 instead of the expected 507. Historical constraint failures and black-corner CDP captures remain failures.
- Cross-machine validation is explicitly deferred because only this Mac is available. A documented hardware/OS/Chrome/DPR matrix is missing. Other Chrome versions, high-density displays, window changes, minimisation, sleep and broader SPA/media implementations need their own retained evidence.
- Reliable native-resolution temporal/spatial coverage, including correct source negotiation and viewport/DPR agreement. The initial 0.4 failures and incomplete geometry probe remain historical evidence; the later FIFO run meets the local gate only on its recorded fixture. Source stalls, small regions, colour management and HDR remain separate limits.
- Independent external adjudication of general/red-flash threshold disagreements, physical visual-field calibration and fresh external reference cases. The [local numeric review](DETECTION-DISAGREEMENTS.md) explains the recorded differences without changing labels or claiming a safe suppression rule. Existing numeric/mask/decoded-media regressions preserve their mismatches; candidate findings require review.
- Account-specific content, arbitrary custom controls and unsupported consent flows.
- DOM allowlists reduce risk but cannot prove that a page's own JavaScript has no side effects. Cross-origin redirects are detected after the browser request has occurred.

Browser restart recovery and stop guards have automated coverage; they have not all been repeated as native toolbar capture scenarios. Native evidence establishes the specific recorded 0.4 fixtures and preserves earlier failures. It supports local development, not acceptance of a later build, a general 0.4 release or a conformance claim.
