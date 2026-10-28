# Maintainability gates

Use [the codebase map](CODEBASE.md) to locate responsibilities and [CONTRIBUTING](../CONTRIBUTING.md) for contributor commands.

## Required checks

- `pnpm check`: TypeScript, semantic ESLint, code contracts, formatting, documentation links, unused code/dependencies and architecture boundaries.
- `pnpm test`: behavior-focused regression suites, including boundary validators, cancellation/finalization, database transactions and the architecture/contract checks themselves.
- `pnpm build`: all workspace builds and kernel integrity verification.
- Scanner changes also require the relevant extension browser tests and the three-engine differential harness used in CI. Retain exact assertions and frozen reference bytes.

Production functions have complexity at most 20 using ESLint's modified switch counting, nesting at most four levels, and JSDoc on exported function/class declarations. New maintained files stay within 250 code lines. Smaller files must still own coherent responsibilities.

Existing debt is explicit: [file ceilings](../.eslint-file-limits.json) and [exact function findings](../.code-quality-baseline.json). Never add exceptions to get a change through CI. The function baseline binds each allowance to its implementation, so changed functions must meet the normal limits; resolved entries must be removed. JSDoc meaning and useful module boundaries remain review responsibilities. Architecture checks inspect static and literal dynamic imports, not arbitrary runtime-computed dependencies.

## Scanner refactor acceptance, 2026-10-28

| Entry module            | Previous code lines | Current code lines |
| ----------------------- | ------------------: | -----------------: |
| `runner-observation.ts` |                 740 |                183 |
| `runner-commands.ts`    |                 674 |                 78 |
| `frame-analyzer.ts`     |                 739 |                206 |
| `store.ts`              |                 372 |                 25 |

Code-line counts exclude comments and blank lines. Logic moved into focused modules; these figures do not represent deleted functionality. The 1,411-code-line publication test file was replaced by behavioral suites and a shared synthetic fixture. Five file exceptions were removed: 74 remain. The initial function baseline contains 54 complexity, eight nesting and 111 missing-public-JSDoc findings, all from unchanged pre-existing functions.

Local validation:

- 656 tests across 76 files pass, including real engine findings through the worker-result validator and cancellation with retained partial evidence.
- All ten extension browser scripts and the retained-evidence review UI pass. Replay's synthetic worker fixture was corrected to omit obsolete `durationMs` and `droppedFrames` quality fields; the production validator remains strict.
- The three-engine differential covers 144 cases, 1,626 findings/callbacks, 23,058 per-frame state checks for each comparison and 4,698 independently checked masks. Frozen temporal state/callback assertions and current AUTO/forced-JS report comparisons remain intact. Existing explicit memory/spatial-witness differences from the older frozen engine remain documented by the harness.
- A local before/after comparison against `8734b60` used 640×360 RGBA, 90 frames, ten warmup frames and six alternating-order trials per engine. Complete reports matched exactly. Median per-frame processing ratios (after/before): uniform pulse 0.899, dense texture 0.980, small patch 1.014, unchanged texture 0.976. This is a bounded local regression check, not a general speed or native-capture claim.

For future engine refactors, require unchanged numeric results and investigate repeatable timing regressions on the same fixtures and machine before accepting the change. Keep capture/conversion/IPC and engine-only timings separate. Native capture acceptance remains governed by [capture validation](CAPTURE_VALIDATION.md).
