# Self-hosting

Use the [delivery runbook](DELIVERY.md) for Cloudflare Workers/D1 setup, environment variables, Turnstile and mail configuration, protected deployment, feed signing and extension packaging. The checked-in Wrangler configuration is local development only. Production fails closed when required bindings, rate limits or secrets are missing, or local challenge fixtures remain enabled.

A hosted release needs a configured HTTPS origin, an independently provisioned D1, the secrets listed in that runbook, real email verification and Turnstile, private backups and a tested recovery process. Do not copy local secrets or advertise a successful local build as a hosted service. The [operations guide](operations.md) and [cost guide](costs.md) cover preparation and remaining provider checks.

Public reports are served through current access checks and are not shared-cacheable. Only the approved signed rule feed belongs on a separate public static bucket/CDN. Never expose a database backup, private report or unlisted link through that feed.
