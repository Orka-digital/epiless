# Spatial reference selection

The selection rule was fixed before evaluating the spatial masks or generated
video sequences against Epiless: include every original mask in
`area_patterns/25pct_341x256` (24 PNG files), every JSON configuration in
`video_creation/wcagc_30fps_area01`, `area02` and `area03` (36 configurations),
their exact spatial/temporal dependency closure, the associated source labels,
generator/configuration documentation and BSD license.

The source is `traceRERC/pse-test-media` at commit
`ef78542aad496827f25064f57aaf13d6a741ba75`. `manifest.json` records the actual
vendored files, original Git blob SHA-1, SHA-256 and pinned source URLs. The
validator verifies those bytes before running a comparison. No case was removed
because of its outcome. The earlier broad tree-based dependency preselection is
superseded by this exact dependency closure; it was not an evaluated corpus.

JSON and CSV expected labels are preserved and scored separately. Malformed JSON
labels and disagreements with the independent CSV are visible source-quality
findings, not silently corrected expectations. Once evaluated, this corpus is a
development regression set, not fresh held-out validation.

The media harness recreates the original opaque single-mask sample sequences,
encodes real FFV1 AVI files, decodes them, checks every frame's bytes and timestamp,
and analyzes the decoded native-resolution pixels. It does not add the optional
upstream delivery padding or exercise browser capture. The generated files are
never played during validation and remain under ignored `artifacts/spatial-media`.
