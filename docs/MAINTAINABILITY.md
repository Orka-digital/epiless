# Maintainability gates

Use [the codebase map](CODEBASE.md) to locate responsibilities and [CONTRIBUTING](../CONTRIBUTING.md) for contributor commands.

## Required checks

- `pnpm check`: TypeScript, semantic ESLint, code contracts, formatting, documentation links, unused code/dependencies and architecture boundaries.
- `pnpm test`: behavior-focused regression suites, including boundary validators, cancellation/finalization, database transactions and the architecture/contract checks themselves.
- `pnpm build`: all workspace builds and kernel integrity verification.
- Scanner changes also require the relevant extension browser tests and the three-engine differential harness used in CI. Retain exact assertions and frozen reference bytes.

Production functions have complexity at most 20 using ESLint's modified switch counting, nesting at most four levels, and JSDoc on exported function/class declarations. New maintained files stay within 250 code lines. Smaller files must still own coherent responsibilities.

The former file and function baselines have been removed. Every maintained file follows the same 250-code-line ceiling; production functions have no complexity, nesting or public-JSDoc exceptions. JSDoc meaning and useful module boundaries remain review responsibilities. Architecture checks inspect static and literal dynamic imports, not arbitrary runtime-computed dependencies.

## Scanner refactor acceptance, 2026-10-28

| Entry module            | Previous code lines | Current code lines |
| ----------------------- | ------------------: | -----------------: |
| `runner-observation.ts` |                 740 |                183 |
| `runner-commands.ts`    |                 674 |                 78 |
| `frame-analyzer.ts`     |                 739 |                206 |
| `store.ts`              |                 372 |                 25 |

Code-line counts exclude comments and blank lines. Logic moved into focused modules; these figures do not represent deleted functionality. The 1,411-code-line publication test file was replaced by behavioral suites and a shared synthetic fixture. That first pass left 74 file exceptions and 173 function findings. The follow-up removes all 74 exceptions and resolves the 54 complexity, eight nesting and 111 missing-public-JSDoc findings. New helpers meet the same limits.

Validation recorded for that first pass:

- 656 tests across 76 files pass, including real engine findings through the worker-result validator and cancellation with retained partial evidence.
- All ten extension browser scripts and the retained-evidence review UI pass. Replay's synthetic worker fixture was corrected to omit obsolete `durationMs` and `droppedFrames` quality fields; the production validator remains strict.
- The three-engine differential covers 144 cases, 1,626 findings/callbacks, 23,058 per-frame state checks for each comparison and 4,698 independently checked masks. Frozen temporal state/callback assertions and current AUTO/forced-JS report comparisons remain intact. Existing explicit memory/spatial-witness differences from the older frozen engine remain documented by the harness.
- A local before/after comparison against `8734b60` used 640×360 RGBA, 90 frames, ten warmup frames and six alternating-order trials per engine. Complete reports matched exactly. Median per-frame processing ratios (after/before): uniform pulse 0.899, dense texture 0.980, small patch 1.014, unchanged texture 0.976. This is a bounded local regression check, not a general speed or native-capture claim.

For future engine refactors, require unchanged numeric results and investigate repeatable timing regressions on the same fixtures and machine before accepting the change. Keep capture/conversion/IPC and engine-only timings separate. Native capture acceptance remains governed by [capture validation](CAPTURE_VALIDATION.md).

## Zero-exception follow-up, 2026-10-29

All 74 file exceptions and 173 function findings are resolved. The two baseline files are deleted. The fixed limits now reject every maintained file above 250 code lines and every production function above complexity 20 or nesting four; exported function/class declarations require JSDoc. No new allowances or frozen-evidence changes were introduced.

Local acceptance on this Mac:

- `pnpm check` passes: types, lint, contracts, formatting, documentation, unused code and architecture. The graph covers 314 production source files without runtime cycles or forbidden dependencies.
- All workspace builds pass. All 656 unit/integration tests pass in 108 behavior suites; all 27 external-harness tests pass.
- All ten extension browser scripts, retained-evidence review UI and 17 web browser tests pass. Web tests used isolated localhost port 4389; the prior local configuration was restored.
- The three-engine differential still passes 144 cases, 1,626 findings/callbacks, 23,058 frozen/current and 23,058 current-backend state comparisons, and 4,698 independently checked masks. The six previously justified spatial-witness differences from the old frozen engine remain explicit.
- Original, expanded, spatial/media and alternating lossless regressions report `NO_NEW_MISMATCHES`. The alternating regression regenerates and checks all 544 decoded frame hashes/timestamps; existing immutable outputs are not overwritten.
- A paired comparison against `0cc2aac` uses 640×360 RGBA, 90 frames, ten warmup frames and six alternating-order trials per engine. Complete reports are identical for uniform pulse, dense texture, small patch and unchanged texture. Median processing ratios (after/before) are 0.974, 0.748, 0.980 and 0.976 respectively. This bounded engine-only test found no timing regression; it does not establish native capture performance or general speed gains.

These checks preserve the existing detection contract. They do not add second-machine evidence or a new native toolbar capture acceptance run. GitHub CI and independent PR review remain separate from this local acceptance record.
