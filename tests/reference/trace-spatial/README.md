# Original spatial masks and lossless decoded media

This corpus is sourced from [Trace RERC's public test media](https://github.com/traceRERC/pse-test-media/tree/ef78542aad496827f25064f57aaf13d6a741ba75).
The BSD license and original source bytes are retained under `upstream/`.
`manifest.json` pins Git blob SHA-1, SHA-256 and source URLs. See
[selection-policy.md](selection-policy.md) for the selection fixed before evaluation.

## Run

Node 24, the workspace dependencies and `ffmpeg`/`ffprobe` must be available.

```sh
node --import tsx --test tests/reference/spatial-media.test.mjs
node --import tsx scripts/validate-spatial-media.mjs --check-baseline
```

The full command decodes the 24 original PNG masks, recreates all 36 original
single-pattern video sequences and encodes real FFV1 AVI files under ignored
`artifacts/spatial-media/`. It decodes those files to native 1920 × 1080 RGBA
frames, verifies **every frame SHA-256 and timestamp**, and then passes those
decoded pixels to the engine. No media are played or rendered on screen.

The mask decoder is cross-checked against an independent PNG alpha reconstruction
using Node's zlib and the PNG row filters. The exact-mask analysis evaluates every
integer-positioned 341 × 256 field; disconnected active pixels count together.
No bounding-box area or image-wide ratio substitutes for that sum.

Only the original source samples are encoded, at 30 fps. No optional delivery
padding, scaling, interpolation, missing-frame repair or colour-space conversion
is applied. The RGBA/BGRA channel reordering is verified lossless by the hashes.
This exercises file generation, encoding, decoding, temporal analysis and exact
spatial arithmetic; it does **not** exercise Chrome capture, a physical display,
viewer distance, HDR or clinical safety.

For a quicker spatial-only check:

```sh
node --import tsx scripts/validate-spatial-media.mjs --masks-only --check-baseline
```

`--check-baseline` allows the recorded disagreements or improvements, but fails
for any new case-level disagreement. An improvement cannot cancel a regression
elsewhere. Changed case identities, labels, decoded bytes, timestamps or the
reference manifest require explicit baseline review. Exit 1 means an integrity,
generation or decoding error; exit 2 means a regression. `--require-match` is the
stricter exact-label mode and currently exits 2. Plain comparison is informational.
`--output PATH` writes a JSON report and refuses to overwrite an existing file.

## First encounter: engine 0.4.0-candidate

The immutable [first-encounter report](first-encounter-0.4.0.json) records the engine
source hash, manifest hash, FFmpeg version, encoded-file hashes, all 1,204 generated
and decoded frame hashes, timestamps and individual outcomes.

| External labels               | Cases scored |  TP |  FN |  FP |  TN |
| ----------------------------- | -----------: | --: | --: | --: | --: |
| Original mask filename labels |           24 |  10 |   2 |   0 |  12 |
| Original video CSV labels     |           36 |  14 |   4 |   0 |  18 |
| Original video JSON labels    |           35 |  10 |   2 |   4 |  19 |

These are disagreements **with the supplied labels**, not a claim that all
reference labels are correct. The source has seven JSON/CSV conflicts, including
the literal malformed JSON value `"s"`, which remains visible and unscored in the
JSON comparison. The other six conflicts are in the red-video group: the JSON
says pass while the separate CSV says fail. Both comparisons are retained.

The two mask disagreements are `f011` and `f012`. Their **entire** nontransparent
mask contains respectively **21,282** and **21,402** pixels, fewer than **21,824**
(25% of 341 × 256). No subrectangle can contain more active pixels than the entire
mask. Independent PNG reconstruction confirms these totals. The four CSV video
disagreements all use these same two masks. The original bytes and labels remain
unchanged; the engine threshold was not adjusted to satisfy this contradiction.

This corpus is now a development regression set. Broader, fresh independent
validation and real browser capture comparisons are still needed.
