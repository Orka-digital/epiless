# Database contracts

The website uses one Cloudflare D1 database and one shared Drizzle schema, exported from [`schema.ts`](../apps/web/src/server/db/schema.ts). The schema is split by responsibility into auth, publications and operations; these are parts of the same schema, not separate databases. Both Better Auth and application queries use [`database(env)`](../apps/web/src/server/db/client.ts).

## Everyday queries

Use Drizzle for reads, inserts, conditional updates, deletes and joins. Keep queries in `apps/web/src/server/db/`. Infer storage types from the schema instead of maintaining parallel row interfaces. Services own authentication, request validation and policy; database functions encode owner scoping and conditional writes. List queries use explicit metadata projections so they do not load report bodies or credentials.

Conditional updates do not require handwritten SQL. Intent verification, cancellation and renewal use Drizzle predicates; challenge consumption uses one `UPDATE ... RETURNING`. The database still arbitrates expiry, cancellation, idempotency and concurrent grants.

Auth timestamps use Drizzle's `timestamp_ms` mapping and auth flags use booleans. Publication timestamps remain integer milliseconds. Account export explicitly converts auth values back to numeric timestamps and flags to preserve the existing version 1 export format. Never export session tokens, credentials or challenge grants.

## Deliberate SQL exceptions

| Module                                                                     | Why SQL remains                                                                                                   | Guarantee                                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`publication-writes.ts`](../apps/web/src/server/db/publication-writes.ts) | Snapshot `INSERT SELECT`, trigger interaction and revision updates followed by `changes()`-guarded ledger entries | Verified content, quota accounting and intent consumption commit atomically; stale revisions cannot add recovery entries. |
| [`moderation-writes.ts`](../apps/web/src/server/db/moderation-writes.ts)   | Ordered revision/event/ledger batches with dependent statements                                                   | Moderation evidence and visibility changes commit or roll back together. Statement order is significant.                  |
| [`account-erasure.ts`](../apps/web/src/server/db/account-erasure.ts)       | Ordered cross-table erasure with a recovery ledger that survives the account                                      | No partial deletion or lost recovery record if any statement fails.                                                       |

Small aggregate expressions in `publication-reads.ts` use Drizzle's parameterized `sql` expressions for SQLite counts, sums and empty-set null semantics. They still reference shared schema columns.

Keep every exception in a focused module under 250 code lines. Document its transaction boundary, guards and ordering in JSDoc. Bind values; never interpolate user input into SQL. Do not split a D1 batch into independent calls or replace a conditional write with a read followed by an unconditional write.

## Migrations and verification

The ordered SQL files in [`apps/web/migrations`](../apps/web/migrations) remain the DDL authority, including quota, metadata, erasure and append-only triggers. Drizzle schema declarations describe the tables, columns, indexes and constraints for typed application access; they do not install those triggers. Do not use schema push or generate a replacement database from Drizzle alone.

For a schema change, add a migration and update the matching shared schema module together. Never rewrite an already-applied migration. This database-layer refactor requires no migration or data conversion.

`pnpm test` checks the shared schema against a fresh database created from every real migration, exercises generated selects for all tables, checks numeric export compatibility and verifies erasure rollback. Backend integration tests cover owner/public/unlisted access, pagination, quotas, idempotent publication, cancellation, moderation, authentication and deletion. `pnpm check` also enforces formatting, JSDoc syntax, typed linting and file limits.
