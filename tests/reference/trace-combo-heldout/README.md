# First encounter: combined general and red patterns

The selection contains **all eight** original CSV inputs in
`combo_flash_patterns/30fps` from TRACE RERC's repository, pinned at commit
`ef78542aad496827f25064f57aaf13d6a741ba75`. The upstream BSD license, label
documentation and exact source bytes are preserved under `upstream/`.

The [manifest](manifest.json) was frozen before scoring, including source Git
blob/SHA-256 identities, the complete selection, expected channel labels and
engine tree `c216fbe2c9de76354061c35ba4df09e7e0a25731e5be247f3a7092aca2ca687a`.
None of these input paths or Git blobs appears in the original 42-case,
expanded 400-case or spatial/media manifests. They were selected as a complete
previously unused family, with no engine changes or outcome-based exclusions.

The independent oracle is the [upstream suffix convention](upstream/combo_flash_patterns/30fps/README.md):

| Suffix | General temporal/intensity candidate | Red temporal/intensity candidate |
| ------ | ------------------------------------ | -------------------------------- |
| `fb`   | Expected                             | Expected                         |
| `fl`   | Expected                             | Not expected                     |
| `fr`   | Not expected                         | Expected                         |
| `p`    | Not expected                         | Not expected                     |

There are **eight independent inputs and sixteen correlated channel checks**.
Each original opaque sRGBA sequence is projected onto one pixel at 30 fps,
without padding, decoding or playback. This does not test the combined area
condition, browser capture, physical display conditions, WCAG conformance,
clinical safety or general real-world accuracy. A malformed or ambiguous
source is retained as unscored; labels are never rewritten to match the engine.

The first encounter is written to a new file and must not be overwritten. Once
evaluated, these inputs are development regression data, not reusable fresh
held-out evidence. No existing CI baseline or expected result is replaced.

```sh
node --import tsx --test tests/reference/validate-combo-heldout.test.mjs
node --import tsx scripts/validate-combo-heldout.mjs --output NEW-RESULT.json
```

The harness rejects changed manifest/source/engine identities, duplicate or
missing inputs and relabelled suffixes. Numeric mismatches are reported intact
with exit code 2; that does not justify changing the source oracle.

## Recorded first encounter

The [first encounter](first-encounter-0.4.0.json) was scored once on 27 October
2026, after freezing the manifest at 18:24:28 UTC; evaluation completed at
18:27:15 UTC. Engine `c216fbe2…` and both kernel identities stayed unchanged.
All eight inputs were valid and scored. The sixteen channel checks contain
**8 TP / 0 FN / 1 FP / 7 TN** against the upstream labels:

| Channel | Inputs checked | TP  | FN  | FP  | TN  |
| ------- | -------------- | --- | --- | --- | --- |
| General | 8              | 4   | 0   | 0   | 4   |
| Red     | 8              | 4   | 0   | 1   | 3   |

The sole disagreement is **`001fl.csv`, red channel**: upstream expects no red
candidate, while the frozen engine records one from 200 to 900 ms. Its expected
general candidate is found. The mismatch remains visible and unadjudicated;
there was no outcome-driven engine edit or label change. Eight files with two
checks each do not establish population-level sensitivity or specificity.

The four pure harness tests pass: suffix channels, complete unseen corpus
identity, changed/excluded/duplicate labels and truncated/altered source bytes.
They verify the harness contract without rescoring the engine. The first result
SHA-256 is `fe0da3e745899360b42bb1c7165ff6b15fdcf51f33988e3f85b63227f262ebe6`;
its manifest SHA-256 is
`abaca272c1b8b0f0d58867bc14c077f7665d21cc67f72da82514370dee39cc36`.

The [independent numeric worksheet](001fl-red-adjudication.json) explains the
extra red alert without importing or rerunning the engine. Immediate RGB changes
yield six qualifying edges; retaining earlier colour endpoints produces eight
alternating qualifying vectors in 700 ms. In particular, frame 21→22 is below
0.2 (0.195463304), whereas 18→22 is above (0.216711455); frame 22→23 stays below,
but 22→25 reaches 0.237424236. This is a transition-endpoint interpretation,
not a floating-point boundary. The worksheet's explicit pairs explain current
behaviour; they are not a newly asserted normative oracle. Neither the upstream
label nor the first-encounter result is changed.

```sh
node scripts/adjudicate-combo-red.mjs --output NEW-ADJUDICATION.json
```
