# Public rule feed foundation

This package builds and verifies deterministic signed JSON. No audit candidate is automatically promoted into a rule. The checked-in selection is empty because no production blocking rules have been validated. It is a P0 protocol prototype, not a complete TUF updater or a working blocker.

From the repository root, build a local empty release:

```sh
pnpm exec tsx packages/rule-feed/src/cli.ts \
  --rules packages/rule-feed/fixtures/empty-rules.json \
  --out .output/feed-local --sequence 1 --key-id local-development --dev-key
```

The development key exists only in memory and is discarded. Only its public key is written. Use a new output directory for every invocation. Production signing uses `--key-file /protected/path/signing.pem` with an Ed25519 PKCS8 private key in a protected release environment. No private key, production feed or trusted production key is checked in. Publishing files to R2/CDN remains a separate protected operation; upload immutable release objects before replacing `feeds/stable/latest.json`.

## Wire format

All JSON uses UTF-8, sorted object keys, preserved array order, no whitespace and no final newline via `@epi-less/core` `stableJson`. Only finite JSON values are allowed. This is a specified local encoding, not an assertion of RFC 8785 compliance. The detached Ed25519 signature covers the exact bytes `FlashGuard rule feed v1\n` followed by canonical manifest payload bytes. The envelope contains unpadded canonical base64url payload and signature, algorithm, schema version and key ID. The key ID is also inside the signed payload. File hashes bind exact decoded bytes, not parsed/reformatted JSON.

Manifest acceptance requires an embedded trusted Ed25519 public key, matching schema/channel/versions, a nonexpired timestamp, bounded sizes and a sequence at least the durable trust floor. The same sequence requires the same previously verified payload hash. A functional rollback is a new higher sequence. A manifest does not provide its own trust root. The API rejects clocks preceding the previously trusted verification time; time persistence and clock-recovery UX belong to the future updater.

`verifyManifest` returns metadata and its payload hash separately from `verifyRulesPayload`: persist new trusted sequence/hash and cumulative revocations before trying a file download. A file hash or storage error must not reactivate withdrawn rules or remove the last valid set. The future updater must persist both cumulative revocations and the highest trusted sequence independently of the currently active rules.

`locallyEligibleRules` applies hard rule expiry, known revocations and local disabled rules. The future caller must persist and supply `lastTrustedTime` so a backward clock does not resurrect already expired rules. It does not expire an already trusted rule set merely because distribution metadata is old. This utility does not implement durable storage, atomic activation, background updates, matching, rendering interventions or network fallback. There is no offline-blocker claim yet.

Rules contain an exact origin/path, a deliberately restricted simple CSS selector, an action enum, a fingerprint digest and explicit approved-review provenance. Arbitrary scripts, attributes, wildcard selectors, CSS snippets, regexes, private reports and unknown fields are rejected. Manual review must still ensure that permitted paths and selectors contain no personal information. Fingerprint collection and application are deferred to the blocker implementation.

The tests generate disposable Ed25519 keys in memory, and check exact payload hashes, tampering, unknown keys, expiry, sequence rollback/reuse, immutable file paths, malformed rules and revocation handling. A public [RFC 8032 Ed25519 test vector](https://www.rfc-editor.org/rfc/rfc8032#section-7.1) separately checks the cryptographic primitive. This is not a substitute for an independent update-protocol security review.

## Local static delivery check

After building the development release above, run from the repository root:

```sh
pnpm feed:preview .output/feed-local
```

This loopback-only static server exposes the approved feed paths on port4388, with separate latest/immutable cache headers and ETags. It has no app/API/D1 dependency. Its integration test downloads and cryptographically verifies the release and checks conditional requests and path restrictions. It is a local origin fixture, not proof of actual Cloudflare edge-cache hits. Stop it with Ctrl+C. Real R2/CDN configuration and production trust remain deferred.
