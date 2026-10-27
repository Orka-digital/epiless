# Development

The [README](../README.md) contains the supported quickstart. Node 24.19.0 and pnpm 11.13.1 are pinned. No remote database, Cloudflare login or production secret is needed for local development.

```sh
pnpm install --frozen-lockfile
EPI_LESS_PORT=4387 pnpm setup:local
EPI_LESS_PORT=4387 pnpm dev
EPI_LESS_WEB_URL=http://localhost:4387 pnpm --filter @epi-less/chrome-extension build
```

Load `apps/chrome-extension/dist` as an unpacked Chrome extension. Start capture through its actual toolbar; a test invoking internal messages alone does not prove native capture permission.

```sh
pnpm check
pnpm test
EPI_LESS_WEB_URL=http://localhost:4387 pnpm build
pnpm exec playwright install chromium
EPI_LESS_PORT=4387 pnpm test:web-quality
EPI_LESS_WEB_URL=http://localhost:4387 pnpm --filter @epi-less/chrome-extension test:browser
pnpm benchmark:index
```

Stop the development server before the browser checks: the web suite starts its own production preview, and the extension suite subsequently binds the same port for its transfer fixture. Keep the extension build and browser-test origin identical.

Keep `.dev.vars`, `.wrangler`, browser profiles, archives and customer data out of Git. Run one build and one local migration process at a time: browser tests use the production build and the shared local D1. Use synthetic reports and non-flashing runner fixtures. Algorithm fixtures are numeric arrays.

The [capture record](CAPTURE_VALIDATION.md) separates native capture evidence from UI/DOM automation. The [P0 acceptance map](P0-ACCEPTANCE.md) separates local functionality from external release gates.
