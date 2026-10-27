# Abuse protection

The app verifies Turnstile on the server for account/mail actions, new publication approvals and abuse reports. Challenges bind the expected action, hostname and request identity; client callback success alone does not grant publication. Signed-in uploads additionally bind the approved snapshot hash, visibility, account and idempotency key. Used/expired challenges cannot grant a new publication.

Reading a public report, searching, downloading an authorized report, local scanning, withdrawing a report and static feed downloads do not require a challenge. Private/unlisted downloads still enforce their ordinary access rules.

Local setup enables an explicit fixture only on the exact loopback development origin. Production configuration rejects that fixture, missing secrets, provider test keys and invalid origin/hostname settings. A passing fixture does not prove the real external widget works.

Before hosting, create independent staging/production Turnstile widgets with exact hostnames and configure `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES`. The secret belongs in the Worker/environment secret store, never client code. Verify success, invalid/replayed/expired tokens, wrong action/hostname and provider timeout with real staging keys.

Request limits are separated by action and actor. Database triggers atomically enforce upload count, active storage and pending-intent quotas. Retries preserve the same idempotency key, obey `Retry-After` and do not bypass a fresh verification requirement. `UPLOADS_PAUSED` provides a write stop without preventing withdrawals. Never log challenge tokens, password fields, snapshots or full IP addresses.

Optional edge WAF rules must exclude challenge-free feed delivery and preserve withdrawal/recovery access. No paid WAF subscription or automated provider configuration is silently assumed.
