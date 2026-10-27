# Delivery and hosting runbook

These workflows are committed implementation, not evidence that a repository, protected environment, Cloudflare service, store listing or production feed already exists. Complete the external gates in [IMPLEMENTATION](IMPLEMENTATION.md) before calling a release production-ready.

## Repository and checks

Use the official repository [Orka-digital/epiless](https://github.com/Orka-digital/epiless), which is temporarily private. The initial [.github/CODEOWNERS](../.github/CODEOWNERS) entry identifies the verified maintainer `@aaronrk1997`. Enable private vulnerability reporting, protected environments, squash merges and branch protection. Require the exact check contexts created by `CI / required` and `Security / security`; check the names in the first actual workflow run before saving the rule. The [branch-protection payload](../.github/branch-protection.json) pins the verified `required` and `security` contexts to GitHub Actions (app 15368). Require independent review, current branches or the merge queue, resolved discussions and code-owner approval. Do not permit force pushes or deletion of `main`.

`ci.yml` runs static checks, unit/integration tests, builds, browser/quality checks and documentation checks on pull requests, `main` and merge groups. Its final job rejects skipped, cancelled and failed dependencies. `security.yml` also checks dependencies weekly. Fork jobs use read-only permissions and no repository secrets. Artifact retention is seven days. Public standard hosted-runner availability does not make storage, every runner type or external services unlimited.

All external Actions are pinned to official commit SHAs. The starting pins were resolved from each publisher's official tag refs on 2026-10-27: checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2 and pnpm/action-setup v6.1.0. Dependabot proposes reviewed updates; the lockfile and frozen installation protect application dependencies separately.

## Local verification

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm setup:local
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:web-quality
pnpm --filter @epi-less/chrome-extension test:browser
```

Keep synthetic captures local. Browser automation of extension UI is not evidence that the operating system's real tab-capture prompt, background navigation continuity or every media source was measured correctly. Record those checks separately on supported Chrome/OS combinations.

## Cloudflare environments

Provision separate staging and production Workers/D1 databases and domains. Use synthetic data in staging. Create GitHub environments named `staging` and `production`, restrict them to reviewed `main`, and require maintainer approval for production. Use the Paid Workers baseline for this initial production configuration: the generated Worker CPU limit is 100 ms, which must be measured against authentication and publication loads before release. Free-plan limits and the full cost envelope must be reviewed separately; there is no claim that the entire service is free.

Each environment needs these repository/environment variables:

| Variable                | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `PUBLIC_APP_ORIGIN`     | Exact HTTPS origin, with no trailing slash or path.           |
| `CLOUDFLARE_ACCOUNT_ID` | Actual 32-character Cloudflare account ID.                    |
| `D1_DATABASE_ID`        | Provisioned database UUID; the local placeholder is rejected. |
| `WORKER_NAME`           | Unique Worker name for the environment.                       |
| `TURNSTILE_SITE_KEY`    | Production Turnstile site key, even for hosted staging.       |
| `TURNSTILE_HOSTNAMES`   | Comma-separated allowlist including the actual app hostname.  |
| `MAIL_FROM`             | Verified sender accepted by the configured Resend account.    |
| `MODERATOR_USER_IDS`    | Authorized maintainer account IDs, never ordinary user input. |

Protected environment secrets are `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET`, `SHARE_TOKEN_SECRET`, `TURNSTILE_SECRET_KEY` and `RESEND_API_KEY`. Generate independent high-entropy auth/share secrets of at least 32 characters. Scope the Cloudflare token to the required Worker, D1 and domain operations for this environment. Do not reuse the feed signing key or R2 credentials here. Verify the sender domain and Turnstile domain/action behavior before public account creation.

The checked-in Wrangler configuration is local-only. The deployment workflow validates required values, rewrites bindings in its ephemeral checkout, sets `ENVIRONMENT=production`, excludes local challenge fixtures, builds the app, validates secrets, applies migrations, deploys and installs secrets through stdin. Missing configuration fails the job. On first deployment the API remains unavailable until valid secrets are installed. Existing deployments retain their stable secret values; rotating them has account/share-token consequences and requires a deliberate recovery plan.

Trigger **Deploy hosted index** on `main`, selecting staging first. The workflow's core deployment commands are:

```sh
node .github/scripts/configure-cloudflare.mjs
pnpm --filter @epi-less/web build
node .github/scripts/apply-cloudflare-secrets.mjs --validate-only
pnpm --filter @epi-less/web exec wrangler d1 migrations apply DB --remote
pnpm --filter @epi-less/web exec wrangler deploy
node .github/scripts/apply-cloudflare-secrets.mjs
node .github/scripts/verify-deployment.mjs
```

Before a production schema change, ensure an encrypted backup and a tested restore procedure are available. The [local operations commands](operations.md) implement encrypted local D1 backups, an independent erasure ledger and isolated conservative restore; they have been rehearsed locally. Keep backups private and apply current erasures after restoration so withdrawn reports are not resurrected. Hosted scheduling, independently durable storage and restore monitoring remain outstanding operations gates and are not implemented by the deploy workflow.

The post-deploy probe checks the homepage, index page and actual read-only D1 index response with `no-store`. It does not prove account email, Turnstile, authorization or publication. Perform the full acceptance flow on staging and then with a disposable production account: sign up and verify email, sign in, import a synthetic report, inspect preview, publish private/unlisted/public snapshots, confirm public index visibility, verify unauthorized access denial, revoke and confirm the old link/index metadata stop resolving. Inspect provider logs without logging report bodies or tokens. Exercise challenge failure, quota/rate limits and account recovery. Record the deployed revision and outcome in the release notes.

Watch Worker requests/CPU, D1 rows read/written, storage, response size, R2 operations and mail usage. Start with small quotas and measure before raising limits. The static site and separate feed avoid database calls for static delivery; dynamic report/search requests still consume server resources.

## Extension release

Create protected `extension-release` with an approved HTTPS `PUBLIC_APP_ORIGIN`. Before tagging, update the package and extension manifest versions together and configure real code owners. Tag only reviewed `main` history:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The tag workflow runs validation/security, checks the tag against `package.json`, builds for the configured origin, packages the extension and attaches a SHA-256 checksum to a **draft** GitHub release. Review the artifact, permissions, privacy policy and real capture evidence before publishing the release or submitting to the Chrome Web Store. Store publishing credentials and submission are deliberately not automated here.

## Public feed: initial trust and publication

Create a separate public R2 bucket containing only reviewed rule artifacts, and attach a dedicated HTTPS CDN hostname. Keep account data and report JSON out of that bucket. Configure explicit caching for the feed routes; public report/search/account responses keep their independent `no-store` policy. Cloudflare cache eviction is possible, so CDN delivery alone is not offline persistence.

Generate a production Ed25519 key in a protected environment. The private key never enters Git, artifacts or logs. Review and distribute the corresponding public JWK through a trusted extension build before any future updater trusts it. The current extension has no feed updater and no trusted production key. A downloaded public key is not a trust root.

The initial approved selection at `packages/rule-feed/approved/rules.json` is intentionally empty. It provides zero blocking coverage. To prepare a local bootstrap artifact using a protected private key:

```sh
node --import tsx packages/rule-feed/src/cli.ts \
  --rules packages/rule-feed/approved/rules.json \
  --revocations packages/rule-feed/approved/revocations.json \
  --out /private/release-output --sequence 1 \
  --key-id YOUR_REVIEWED_KEY_ID --key-file /protected/feed-signing.pem
```

Use a new output directory. The CLI verifies its own signature, file hash and schema before writing `latest.json`. Review the exported public JWK and configured CDN content independently. For bootstrap only, an authorized operator uploads the content-addressed rules and release manifest, verifies their CDN bytes, then uploads `feeds/stable/latest.json` with a create-only `If-None-Match: *` condition. Preserve the immutable release bytes and confirm the R2/CDN result before enabling subsequent publication. This initial account/trust bootstrap is not silently performed by CI.

Create protected environment `feed-production` restricted to `main`, with:

| Setting                                            | Meaning                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Variable `CLOUDFLARE_ACCOUNT_ID`                   | R2 account ID.                                               |
| Variable `FEED_BUCKET`                             | Dedicated public-feed bucket.                                |
| Variable `FEED_CDN_ORIGIN`                         | Exact HTTPS CDN origin.                                      |
| Variable `FEED_SIGNING_KEY_ID`                     | Approved signing-key identifier.                             |
| Variable `FEED_TRUSTED_KEYS`                       | JSON object mapping approved key IDs to public Ed25519 JWKs. |
| Secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Bucket-scoped R2 S3 credentials.                             |
| Secret `FEED_SIGNING_PRIVATE_KEY`                  | Matching Ed25519 private key in PEM format.                  |

The hosted runner needs AWS CLI with conditional `PutObject` support; the workflow fails if it is unavailable. Trigger **Publish public rule feed** with the exact current sequence. The publisher reads and authenticates current metadata directly from R2, carries forward cumulative revocations, signs the approved selection at the next sequence, verifies immutable uploads through R2 and the CDN, and advances `latest.json` only with the previous ETag's atomic `If-Match`. A concurrent external write therefore fails rather than overwriting newer state. [Cloudflare's conditional S3 operations](https://developers.cloudflare.com/r2/api/s3/api/)

Immutable objects use `public, max-age=31536000, immutable`. Latest metadata uses `public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400`; verify actual CDN behavior after configuration. A cached latest manifest may remain old until revalidation. Client signatures, sequence floors and metadata expiry remain authoritative.

On a partial failure, keep the previous latest pointer. Retry with the original logged `generated_at` so immutable bytes remain identical; investigate any object mismatch. The workflow does not bootstrap a missing feed or silently decrement a sequence. A functional rollback publishes fixed content under a higher sequence and preserves known revocations. A planned daily renewal, independent mirror, durable local updater, atomic client activation and real offline blocking tests remain future work.
