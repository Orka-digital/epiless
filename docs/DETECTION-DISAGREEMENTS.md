# Temporal detection disagreements

This is a numeric review of the **18 disagreements in the expanded Trace corpus**, with the two original staircase disagreements included for context. It does not change source labels, historical scores or the detector. These are disagreements with the upstream expectations; they are not all established false alarms under WCAG.

The review does **not** establish a safe detector correction that eliminates these cases without losing valid candidates. Seven transitions are supported by official W3C guidance. Most disagreements concern how multiple steps form one excursion. One red case retains a material uncertainty about the permitted duration of an excursion.

| Cases                                                                         | Count | What the independent calculation establishes                                                                                                    | Disposition                                                                                                  |
| ----------------------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Original `l031_srgba.csv`, `y031_srgba.csv`                                   |     2 | Each has seven qualifying, alternating peak/valley excursions inside a one-second interval, despite some individual steps being below threshold | Step-versus-excursion disagreement; do not suppress on individual-step size                                  |
| Expanded `l032_srgba.csv`–`l039_srgba.csv`, `y032_srgba.csv`–`y039_srgba.csv` |    16 | Same extrema positions; every complete excursion exceeds 0.1 and the darker endpoint is below 0.8                                               | Same family; preserve upstream labels and record the contrary numeric evidence                               |
| Expanded `dr011_multi.csv`                                                    |     1 | Seven qualifying, opposing red transitions occur before a weaker eighth return                                                                  | Seven-transition interpretation is supported by W3C; requiring the eighth would discard supported candidates |
| Expanded `s014_multi.csv`                                                     |     1 | Retaining an earlier anchor qualifies a transition across a plateau; comparing immediate steps does not                                         | Unresolved duration/transition interpretation; neither label correction nor suppression is justified here    |

The expanded count remains **16 general + 2 red = 18**. Including the original context cases gives 20 reviewed files, of which 18 are staircase cases. Historical benchmark statistics remain unchanged.

## Primary definitions and source integrity

[WCAG 2.2's threshold definition](https://www.w3.org/TR/WCAG22/#dfn-general-flash-and-red-flash-thresholds) defines opposing changes and describes transitions using adjacent peaks and valleys. Its red working definition uses a saturated-red endpoint and a chromaticity difference greater than 0.2. It does not specify a maximum duration for completing an excursion. These notes help interpretation; this review is not a normative conformance ruling.

[W3C technique G19](https://www.w3.org/WAI/WCAG22/Techniques/general/G19#description) explicitly explains that seven alternating light/dark transitions constitute 3.5 flashes, exceeding three. The technique is informative, but directly contradicts a proposed blanket requirement for eight transitions. The original Trace authors' [2024 gap analysis, §5.3 and §6.4.1](https://pmc.ncbi.nlm.nih.gov/articles/PMC11872230/) likewise describes seven-transition counting and identifies transition duration as an unresolved standards issue for which it proposes additional guidance. That proposed duration must not silently become a WCAG exclusion.

All input CSVs are pinned to Trace commit [`ef78542aad496827f25064f57aaf13d6a741ba75`](https://github.com/traceRERC/pse-test-media/tree/ef78542aad496827f25064f57aaf13d6a741ba75). The [luminance README](https://github.com/traceRERC/pse-test-media/blob/ef78542aad496827f25064f57aaf13d6a741ba75/lum_flash_patterns/rel_lum/README.md) labels `l`/`y` cases as passing and describes the `03n` family as multiple steps. The [red README](https://github.com/traceRERC/pse-test-media/blob/ef78542aad496827f25064f57aaf13d6a741ba75/red_flash_patterns/30fps/README.md) labels `d`/`s` cases as passing. Both explicitly describe seven alternating transitions as exceeding the count threshold.

The pinned [`generate_frames.py`](https://github.com/traceRERC/pse-test-media/blob/ef78542aad496827f25064f57aaf13d6a741ba75/generate_frames.py#L45-L81) reads CSV rows in order and recolours opaque spatial-mask pixels. [`generate_video.py`](https://github.com/traceRERC/pse-test-media/blob/ef78542aad496827f25064f57aaf13d6a741ba75/generate_video.py#L66-L76) writes those frames in sequence, with optional initial padding. Neither computes the temporal labels or a transition verdict. No separate temporal-CSV authoring generator was present in that pinned tree; the numeric inputs and documented expectations are the available evidence. This review adds no padding, playback, codec transformation or synthetic source frames.

| Source CSV                                                                                                   | Verified SHA-256                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`l031_srgba.csv`](../tests/reference/trace-pse/upstream/lum_flash_patterns/rel_lum/l031_srgba.csv)          | `42f6592ee9139571e0f4a2bbcf966d3e3931f7f69bfe6ee376b2f1f89eeb8c56` |
| [`y031_srgba.csv`](../tests/reference/trace-pse/upstream/lum_flash_patterns/rel_lum/y031_srgba.csv)          | `7386c9b9b870bc6a59a25c57395618d39475ef1607d3728bb0e7c57a9cff952c` |
| [`dr011_multi.csv`](../tests/reference/trace-pse-expanded/upstream/red_flash_patterns/30fps/dr011_multi.csv) | `942fdf7364806f7c301f3b6ce22d719419eee45cd68efdc8849c309ecf35b4a3` |
| [`s014_multi.csv`](../tests/reference/trace-pse-expanded/upstream/red_flash_patterns/30fps/s014_multi.csv)   | `7021bde7cd5bf722569bd8a2ac7158206f818d54627f8173b0734790eefd328c` |

The retained artifact contains all 20 CSV hashes and both manifest hashes. The reproducer checks each CSV against its pinned manifest before calculating its trace.

## Staircases: a step is not necessarily an excursion

For `l031`, linearized grayscale luminance is:

| Source value | Relative luminance | Change from previous row |
| ------------ | -----------------: | -----------------------: |
| 64           |        0.051269458 |                        — |
| 108          |        0.149959790 |             +0.098690331 |
| 136          |        0.246201327 |             +0.096241537 |
| 64           |        0.051269458 |             −0.194931868 |

The two increasing steps are individually below 0.1, but have no intervening reversal. The valley-to-peak change is **0.194931868**. Treating each video-row difference as the entire transition loses that excursion.

After equal samples and monotone internal steps are removed, both original files and all 16 expanded staircase files have extrema at source frames:

```text
1 → 3 → 4 → 12 → 14 → 23 → 25 → 32 → 33
```

There is an explicit one-second witness from **90 ms to 1090 ms**. At its start, the source still holds frame 3's peak; the following seven alternating transitions complete at:

```text
100, 366.666667, 433.333333, 733.333333,
800, 1033.333333, 1066.666667 ms
```

This witness includes the initial held colour, avoiding an inference based only on the separation between the first and last transition-completion timestamps. The least excursion magnitude across this family is **0.185188880**, and the highest darker endpoint is **0.799102738**. Thus all seven excursions clear the general temporal/intensity thresholds under an adjacent-extremum interpretation. This says nothing about sufficient flashing area.

`y031` has larger steps in most pulses, but the allegedly insufficient pulse still goes from 64 to 136 and back, with magnitude 0.194931868. The same witness therefore applies. The current [`generalTransition`](../packages/analysis-engine/src/index.ts) retains the extremum and counts reversals; it does not count the two upward steps as two opposing transitions. Replacing it with immediate-frame comparisons would remove valid gradual changes as well as these disagreements.

## `dr011`: the weak eighth transition arrives after the trigger

The unchanged colour rows yield these qualifying transitions. At least one endpoint of each is saturated red; successive chromaticity vectors have negative dot products.

| Ending source frame |   Time, ms | CIE u′v′ distance |
| ------------------: | ---------: | ----------------: |
|                   2 |  33.333333 |       0.205823486 |
|                   3 |  66.666667 |       0.228766841 |
|                  12 | 366.666667 |       0.205974355 |
|                  13 |        400 |       0.210741340 |
|                  22 |        700 |       0.203865030 |
|                  23 | 733.333333 |       0.203865030 |
|                  31 |       1000 |       0.203865030 |

These are three disjoint opposing pairs followed by another opposing transition, all inside a one-second interval beginning just after 0 ms while frame 1 is still held. The first-to-seventh completion span is 966.666667 ms. The eighth transition, ending at frame 32, measures **0.197578605** and does not qualify. It does not undo the preceding seven.

This contradicts the explanation that a detector must wait for a complete fourth pair. It does not establish that every upstream expectation is wrong. The retained record remains a disagreement requiring external adjudication; the documented seven-transition interpretation supports retaining this candidate.

## `s014`: saturated red reached after a plateau

The first return from green is deliberately just below the saturation threshold:

| Source frame | RGB        | Red fraction | Distance from preceding changed colour |
| -----------: | ---------- | -----------: | -------------------------------------: |
|            2 | 29,127,127 |  0.028131756 |                            0.204946932 |
|            3 | 195,74,74  |  0.799384515 |                            0.204118105 |
|           10 | 196,74,74  |  0.801215164 |                            0.000828827 |

Frames 3–9 hold the same colour. At frame 10 the immediate colour change is tiny, but the distance from frame 2's retained green anchor is **0.204946932**, with a saturated-red endpoint. Both u′ and v′ continue in the same direction from green through the plateau to the final red; no intervening chromaticity reversal explains discarding the earlier anchor.

Immediate-step comparisons produce no sequence of seven opposing qualifying edges. The current retained-anchor policy does, ending at frames **2, 10, 12, 13, 22, 23, 31**. The question is whether the excursion may still qualify after the 233.333333 ms plateau. W3C supplies no explicit maximum transition duration. The Trace author's [2025 methodology, §3.4](https://pmc.ncbi.nlm.nih.gov/articles/PMC12249941/) identifies precisely this duration question as incompletely specified. It cannot be resolved by silently selecting a convenient timeout or by treating a research proposal as an adopted requirement.

The artifact exposes both calculations. Its retained-anchor trace reconstructs the detector's policy to explain the result; it is **not** an independent normative red-flash oracle. The negative vector-dot opposition test is also an implementation choice, not an algorithm mandated by W3C.

## Reproduce and interpret

From the repository root, with the documented Node version:

```sh
node scripts/adjudicate-temporal.mjs
```

The [script](../scripts/adjudicate-temporal.mjs) reads the original CSVs, verifies their hashes and expectations against the pinned manifests, and writes deterministic JSON to stdout. It imports no engine code and does not run browser capture or benchmarks. The checked-in [numeric artifact](../tests/reference/temporal-disagreements-adjudication.json) contains the calculation. Detailed traces are retained for the four cases above; the remaining 16 contain extrema, minimum magnitude, darker-endpoint maximum and their exact one-second witness.

To check that the artifact still reproduces without overwriting it:

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import {readFile} from "node:fs/promises"; import {adjudicateTemporal} from "./scripts/adjudicate-temporal.mjs"; assert.deepEqual(await adjudicateTemporal(), JSON.parse(await readFile("tests/reference/temporal-disagreements-adjudication.json", "utf8")));'
```

There is no justified production threshold change from this review alone. Preserve seven-transition candidates, preserve the source labels and historical disagreement counts, and attach this evidence to future external adjudication. In particular, do not require eight transitions, reduce every excursion to a single frame difference, or suppress delayed saturation using an unvalidated timeout. Those changes can introduce missed detections. A future duration model needs explicit primary-source justification and separate tests for ramps, plateaus, reversals and timing boundaries before it changes candidate visibility.

This analysis covers temporal/intensity interpretations in supplied sRGB samples. It establishes neither normative area compliance, a physical display's behaviour, independent certification nor freedom from photosensitivity risk. Broader evidence and remaining limits are tracked in [SCANNER-QUALITY.md](SCANNER-QUALITY.md).
