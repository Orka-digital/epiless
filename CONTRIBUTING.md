# Contributing to epi-less

Start with the [README](README.md) and [implementation checklist](docs/IMPLEMENTATION.md). Small pull requests with a clear user-visible problem are easiest to review. Discuss substantial changes to capture permissions, audit conclusions, publication or the feed protocol before expanding them.

1. Install the pinned Node and pnpm versions, run `pnpm install --frozen-lockfile` and `pnpm setup:local`.
2. Create a branch for one coherent change. Use synthetic reports and your own test sites.
3. Add meaningful tests for changed behavior. A detector change needs numeric fixtures; a sharing change needs access and revocation checks; a UI change needs a browser check.
4. Run `pnpm check`, `pnpm test` and `pnpm build`. For UI/extension changes, install Chromium with `pnpm exec playwright install chromium` and run `pnpm test:e2e`.
5. Describe the problem, resulting behavior, validation and remaining limitations in the pull request.

Do not turn an inconclusive result into a pass, hide missing coverage, upload captured video by default, broaden autonomous actions into transactions or put network requests on the future blocker's matching path. Keep production secrets and personal audit content out of Git, tests, issues and CI artifacts. Product pages must remain readable without motion; do not introduce flashing demos.

## Documented module boundaries

Give each module one clear responsibility. Split files when they mix state ownership, transport validation, policy and rendering; a line count alone is not a reason to create another wrapper. ESLint enforces a maximum of 250 code lines per maintained JavaScript, TypeScript, TSX or Astro file, excluding blank lines and comments. Existing oversized files have exact, non-growing ceilings in [.eslint-file-limits.json](.eslint-file-limits.json); this is visible refactoring debt, not an exemption for new modules. Lower or remove a ceiling when splitting its file. Do not add entries, raise ceilings, disable the rule or compress code to make a check pass. Frozen evidence and generated sources remain outside this gate.

Use JSDoc for exported functions, factories and non-obvious contracts. Explain the purpose, meaningful parameters, return behavior, side effects and failure conditions. Document safety and privacy limits near the code that enforces them. TypeScript declarations own the types; do not duplicate them in `{Type}` tags. JavaScript helpers still need explicit JSDoc types under `checkJs`. Avoid comments that merely repeat a function name.

Components should own a coherent UI responsibility and receive explicit typed data and callbacks. Keep asynchronous workflows and state ownership in focused hooks/services, use composition for nested content, and reuse existing controls when their behavior is shared. Avoid nested component definitions and one-line wrappers created only to satisfy a line count.

A structural refactor must retain behavior and existing regression coverage. Internal modules should import their direct dependencies, not their own entrypoint; avoid circular dependencies and expanding a package's public API just to share a helper. Update [the codebase map](docs/CODEBASE.md) when responsibilities move.

Use the [shared database schema and query conventions](docs/DATABASE.md) for web database work. Ordinary reads and writes use Drizzle. Keep necessary SQL exceptions in small database modules with JSDoc explaining atomicity, revision guards and statement ordering; migrations remain responsible for triggers.

## Formatting

Prettier is pinned in the root workspace and uses the shared [.prettierrc.json](.prettierrc.json), including the Astro plugin. It formats JavaScript, TypeScript, JSX/TSX, Astro, HTML, CSS, JSON, YAML and Markdown. The shared style uses two spaces, semicolons, single quotes in JavaScript, trailing commas and LF line endings. The 80-column print width is a formatting target, not a hard line-length limit; Markdown prose keeps its existing wrapping.

- Run `pnpm format` to format all eligible files, then inspect the diff.
- For a focused change, use `pnpm exec prettier --write path/to/file.ts path/to/component.astro`.
- Run `pnpm format:check` for a read-only formatting check. `pnpm check` includes it, and the required CI checks reject formatting differences.

VS Code recommends Prettier, Astro and EditorConfig extensions through [.vscode/extensions.json](.vscode/extensions.json). Install them to enable the checked-in format-on-save settings for supported languages. Other editors can use [.editorconfig](.editorconfig) and the local workspace Prettier installation. Keep save actions consistent with [.prettierignore](.prettierignore); do not add a separate whitespace cleanup that rewrites excluded evidence.

Generated output, the lockfile, the original product specification and byte-exact evidence listed in `.prettierignore` are excluded from automatic formatting. Retained evidence has broader EditorConfig exclusions to avoid incidental save-time changes. Do not reformat a frozen reference or capture export to satisfy a style check: its bytes may be bound to a SHA-256 hash.

Prettier handles layout, including existing comments. It does not require JSDoc, validate its meaning, find unused code or enforce module size. Those responsibilities remain with ESLint, TypeScript, Knip, regression checks and review of the documented module boundaries above.

## Linting

Run `pnpm lint` for a read-only ESLint check, or `pnpm lint:fix` to apply available fixes and then inspect the diff. Both commands reject warnings. `pnpm check` includes linting, so the existing required CI gate enforces it. VS Code recommends the ESLint extension and enables diagnostics for JavaScript, TypeScript, React and Astro; Prettier remains the formatter.

The shared [ESLint configuration](eslint.config.mjs) applies JavaScript and TypeScript recommended rules, Astro's recommended rules, React Hooks' recommended rules (including compiler diagnostics), and checks the names and type syntax of existing JSDoc tags. Production TypeScript also uses the project's type information to catch floating promises, misused async callbacks, awaiting non-promises and unnecessary type assertions. Exported function and class declarations also require JSDoc through `pnpm check:contracts`; explanatory quality still requires review.

Test files retain an explicit `any` exception for malformed boundary inputs and partial browser mocks. The production ban remains enabled. Generated sources, third-party reference code and retained extension evidence are excluded. Intentional exceptions in maintained code must use a narrow disable comment explaining the reason; unused disable comments fail linting. Never silence a whole file or weaken a rule just to make CI green.

`pnpm lint` also runs `pnpm check:contracts`: ESLint limits production function complexity to 20 (modified switch counting) and nesting to four levels. [.code-quality-baseline.json](.code-quality-baseline.json) records exact unchanged legacy functions, including missing public JSDoc. Function signatures bind each exception to its implementation: a substantive edit must resolve the finding rather than inherit a larger allowance. Remove resolved entries; never add or regenerate entries to make changed code pass. Tests and generated kernels are outside this production complexity gate.

`pnpm check:architecture` checks static imports, literal dynamic imports and re-exports, including Astro frontmatter. It rejects runtime import cycles, relative cross-workspace imports, undeclared package entrypoints and forbidden UI/worker/server/database dependencies. Type-only edges do not create runtime cycles, but must still respect package exports. Keep dependencies through documented contracts; this check does not infer arbitrary computed dynamic imports or prove semantic separation.

These checks complement strict TypeScript, Knip and browser tests. The file-length rule checks size, not component quality; responsibilities and useful reuse still need review. These checks do not prove scanner accuracy or replace accessibility and security verification.

Pin dependency and Action changes and explain their purpose. Fork pull requests receive no deployment, signing, mail or account secrets.

Maintainers use squash merges into `main` after the required checks and independent review. Do not ask contributors to sign an additional contributor agreement. By submitting a contribution, you agree to license it under the repository's existing MIT terms and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
