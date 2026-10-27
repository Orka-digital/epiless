# Governance

epi-less is a community project initiated and stewarded by Orka Digital. Contributors can propose improvements, report bugs and run their own deployments under the MIT license. Only maintainers explicitly authorized by the project steward manage official release credentials and production accounts.

Decisions should be visible in issues or pull requests with their rationale. Changes to report meaning, privacy, capture permissions, public data selection or update trust require explicit maintainer review. Approved rule data is reviewed separately from engine findings; an automated candidate is never an approved public blocking rule.

Protect `main` against force pushes and deletion. Require the `CI / required` and `Security / security` checks, resolved discussions and at least one independent approval, with code-owner review for protected paths. Enable squash merges and delete merged branches. If a merge queue is available, the same checks run on `merge_group`; otherwise require the branch to be current before merging.

The repository is [epi-less](https://github.com/Orka-digital/epiless). Its initial code owner is [@aaronrk1997](https://github.com/aaronrk1997), recorded in [.github/CODEOWNERS](.github/CODEOWNERS). Repository rules and actual reviewer access must still be configured and verified on GitHub; a local ownership file alone does not enforce them. If there is only one founding maintainer, an explicit logged temporary review exception may be used; it never bypasses required tests or secret/environment restrictions. Remove the exception when a second reviewer is available.

Release tags must point to reviewed `main` history. The release workflow produces a draft, not an automatic Chrome Web Store submission. Cloudflare deployments and public-feed publication use separate protected environments with reviewers and scoped secrets. Never execute a contributor's code in a secret-bearing `pull_request_target` job.

Maintainers enforce the [Code of Conduct](CODE_OF_CONDUCT.md), explain moderation decisions where privacy permits, and provide a private appeal path through another maintainer when available. Ownership and access changes should be recorded in this document.
