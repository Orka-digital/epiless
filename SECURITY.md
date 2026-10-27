# Security policy

epi-less is an early implementation. Only the latest maintained release will receive security fixes; there is no production release or support window announced yet.

While the repository is private, contact a listed maintainer privately through their published profile or the agreed collaborator channel. When enabled and available, [Security → Report a vulnerability](https://github.com/Orka-digital/epiless/security/advisories/new) is also a private reporting route. Do not post exploit details, private reports, share tokens or credentials in a public issue. The repository owner must enable and test the private reporting route before a public release; no unverified security email address is advertised here.

A useful report includes affected versions, a minimal synthetic reproduction, expected and actual behavior, and the potential impact. Keep testing to your own local instance and content you are authorized to inspect. Maintainers should acknowledge a report within five business days and agree a disclosure plan; this is a project target, not a guaranteed incident-response service.

Particular review boundaries are account/session access, unlisted tokens, revocation, upload privacy, capture permissions, autonomous actions, Turnstile verification, quota races, fork workflow permissions and signed-feed trust/rollback behavior. Detector observations are not a medical guarantee or a validated WCAG verdict.

Production signing keys, R2 credentials and Cloudflare API tokens belong in protected environments. A suspected feed-key compromise requires stopping publication, investigating affected releases and rotating trust through an already trusted mechanism or an extension update. Publishing a new key next to the feed does not establish trust. See [the delivery runbook](docs/DELIVERY.md).
