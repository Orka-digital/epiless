# TRACE alternating compositions: frozen first encounter

This corpus contains all 16 original `video_creation/30fps_alternating_01`
configurations from TRACE commit
`ef78542aad496827f25064f57aaf13d6a741ba75`, their complete dependency closure,
original labels, source generators, documentation and BSD license. No case was
selected or excluded using the scanner outcome.

The [manifest](manifest.json) was frozen before evaluation at
`2026-10-27T19:19:15.169437+00:00`; its SHA-256 is
`435e47961469043376dde6e90c52e726604a66366087a6537f351cdf64740092`.
All 46 files retain their original bytes, SHA-256 and Git blob identity.

The 16 configurations and 8 spatial masks were absent from the previous four
corpora. All 12 temporal CSV dependencies were already present. Thus this is a
first encounter with new full-frame compositions, **not** 16 independent unseen
temporal oracles. Exact overlaps are listed per file in the manifest. The
[upstream family contract](upstream/video_creation/30fps_alternating_01/README.md)
describes alternating luminance transitions in one area larger than a quarter of
the screen; both original JSON and CSV expectations are retained separately.

The local harness uses unchanged engine `c216fbe2…`, real FFV1 level 3 files,
independent PNG-alpha reconstruction, and full lossless decoding. It validates
every decoded RGBA frame and presentation timestamp before analysis. The
explicit 341×256 source-pixel field matches the existing reference methodology;
it is not a measured physical field or browser CSS mapping. Original event
annotations remain unscored because their endpoint/index convention has not been
independently established. Generated media must not be played as part of this
validation.

```sh
node --import tsx --test tests/reference/validate-alternating-heldout.test.mjs
node --import tsx scripts/validate-alternating-heldout.mjs \
  --output artifacts/alternating-rerun.json \
  --media-directory artifacts/alternating-rerun
```

Output files and encoded media use exclusive creation: existing evidence is
never overwritten. After the first evaluation this set becomes development
regression evidence; it establishes no population accuracy, clinical safety,
WCAG conformance or state-of-the-art claim.

The immutable [first score](first-encounter-0.4.0.json) agrees with all original
JSON and CSV labels: **4 TP, 0 FN, 0 FP, 12 TN**, across 544 decoded frames.
The [provenance](first-encounter-provenance.json) binds the original evidence,
manifest, harness and [frozen engine source archive](frozen-engine-c216.tar.gz).
Reproduction must use those c216 engine bytes; the first-encounter harness
intentionally rejects a later engine.

Current-engine regression uses a separate runner. It leaves the c216 first score
and its strict harness unchanged, regenerates its own lossless files from pinned
sources, and requires all 544 decoded frame hashes and PTS to match that original
score. Both JSON and CSV verdicts are compared per configuration; a new mismatch
fails the gate. The FFV1 container hash is recorded separately because ffmpeg
versions can encode the same exact pixels differently.

```sh
node --import tsx --test tests/reference/validate-alternating-regression.test.mjs
node --import tsx scripts/validate-alternating-regression.mjs \
  --output artifacts/alternating-regression.json
```

CI installs ffmpeg and runs this gate without local temporary files, browser
profiles or stored encoded media. It regenerates the small 16-video corpus.

The [0ce8 inverse-phase regression](../../../packages/analysis-engine/validation/alternating-inverse-phase-0.4.0.json)
also retains 4 TP, 0 FN, 0 FP and 12 TN against both label sources, with all 544
regenerated/decoded frame hashes and PTS unchanged. It is a subsequent regression
checkpoint, not a second unseen evaluation.
