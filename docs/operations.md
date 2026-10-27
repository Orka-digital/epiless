# Local operations and recovery

Hosting is deliberately deferred. These commands run locally and do not provision or modify Cloudflare services. The production acceptance gates remain in [IMPLEMENTATION](IMPLEMENTATION.md).

## Encrypted backup and withdrawal-safe restore

Keep `EPI_LESS_BACKUP_KEY` in your password manager or an environment supplied by your private secret manager. It must contain 32 random bytes encoded as 64 hexadecimal characters. Never put the key in Git, a command-line argument, a public CI artifact or the same directory as the archives. Losing the key makes an archive unrecoverable.

```sh
pnpm backup:local --out /private/epiless-backups
pnpm backup:prepare-restore --backup /private/epiless-backups/OLDER.backup --ledger /private/epiless-backups/FRESH.ledger --out /private/restored.sql
```

The backup command exports local D1 into a temporary private directory, encrypts the SQL and an independent deletion/revocation ledger using AES-256-GCM, then removes the temporary plaintext. Archive files are created with owner-only permissions and never overwritten. Do not run it against the live production database: this command always uses `--local`.

The restore preparation reads authenticated archives into an isolated SQLite database. It applies account/report erasures from the fresh ledger, checks database integrity and foreign keys, and generates an owner-readable SQL file for an **empty** local database. It never overwrites the working database. All restored shares are revoked and set private, link versions advance, login sessions/mail tokens expire and old publication approvals are permanently cancelled. Password hashes and provider credentials are cleared, so an older backup cannot undo a password reset: recovered accounts must complete a verified password reset before signing in. Recovering an old backup cannot silently republish a withdrawn report. Any future sharing requires a new review and approval.

Pause writes before exporting the recovery ledger and keep them paused through recovery. The ledger must be from the same database, newer than the backup and no more than five minutes old. If the current ledger is unavailable, restoration fails; do not restore old public access based solely on a backup. Preserve the independent ledger through backup rotation. The ledger contains opaque identifiers and actions, not report bodies or names, and is protected from updates/deletion by database triggers.

For a local rehearsal, import the prepared SQL into a new empty database, verify private access, revoked links, erased accounts and the index, then remove the plaintext SQL. The regression tests exercise restore after both account deletion and report deletion. A real local D1 export/encryption/restore rehearsal also passed integrity and foreign-key checks, with zero active shares, sessions, restored credentials or renewable old approvals. Its temporary plaintext and archives were removed. A hosted backup schedule, separately durable ledger, encrypted private storage, provider recovery and actual disaster drill must still be configured before public launch.

## Usage limits and maintenance

`UPLOADS_PAUSED=true` rejects new intents/commits with `503` and `Retry-After`, while keeping report reads, withdrawal, deletion and account access available. Use it during a write freeze or an approaching operational limit; it does not retroactively delete local scans or online reports.

```sh
pnpm ops:budget --input /private/measured-usage.json
```

The input must contain measured values and matching units, for example:

```json
{
  "measuredAt": "2026-10-27T00:00:00Z",
  "metrics": [{ "name": "storage", "used": 80, "limit": 100, "unit": "MiB" }]
}
```

Thresholds are 50% (notice), 80% (warning), 95% (critical, exit code 2). Missing/invalid measurements fail instead of appearing as zero usage. This command does not claim to collect provider billing data or enforce a hard invoice cap. Connect it to actual provider counters and your chosen private alert channel before hosting.

## Retention policy for hosting preparation

- Local compact scan history remains until the user deletes it. Detailed findings expire according to the extension's configurable retention setting; expiry remains visible in exports.
- Approved web upload snapshots remain in the browser until cancelled/completed entries are removed. Logging out pauses account-bound work; it does not erase another account's local data.
- Online report snapshots remain until their owner deletes them. Withdrawal disables sharing; deletion erases content and keeps a minimal retry tombstone.
- Proposed operational logs: seven days, no report bodies, tokens, full IP addresses or passwords. Provider configuration must enforce this before launch.
- Proposed encrypted private backups: 30 daily copies. Erasure records must outlive every recoverable backup. Do not advertise these as active provider settings before deployment verification.
- Public CI artifacts contain synthetic data only and expire after seven days.

No hosted retention, billing alerts or backup schedule has been activated by this local implementation.
