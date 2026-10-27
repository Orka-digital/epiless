# Storage and cost verification

Run the reproducible synthetic benchmark:

```sh
pnpm benchmark:index
```

It creates a disposable SQLite database with the actual application migrations, inserts 10,000 synthetic reports through the real quota/metadata triggers, measures database size and metadata-query latency, and removes the database. The JSON result is `artifacts/index-benchmark.json`; CI retains it for seven days.

The local run with all four migrations on Node 24.19.0/macOS used eight observed routes per report:

| Measurement                                | Local result |
| ------------------------------------------ | -----------: |
| Reports                                    |       10,000 |
| Mean report JSON                           |  6,300 bytes |
| Report JSON total                          |    60.08 MiB |
| SQLite database including metadata/indexes |    86.51 MiB |
| Storage / JSON ratio                       |         1.44 |

Recent-report, exact-origin, audit-date, domain-prefix and site-summary queries used SQL indexes. The domain-prefix query also uses a temporary sort; the benchmark includes that actual search shape. Local warm SQLite latency is not a prediction of worldwide response time. Fixtures are deliberately compact; larger reports and more findings consume more storage. The 1 MiB upload limit and 25 MiB per-account storage limit remain authoritative.

This benchmark does **not** measure Cloudflare Worker CPU, billable D1 rows, network latency, mail volume, R2 operations or a monthly invoice. The $5–10/month figure in the specification remains a target, not a measured production result. Before hosting, check current provider prices and the share of the hosting account allowances available to this project, then measure the actual account, upload, search and read flows.

The implementation uses static Astro pages where possible, zero browser JavaScript for public reading/search, SQL metadata rather than full snapshot reads for index lists, and a separate static signed feed. It does not run cloud browser scans. The [operations guide](operations.md) covers local 50/80/95% threshold evaluation and pausing new uploads.
