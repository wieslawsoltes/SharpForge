# Final IO publication status and exact limits

Fresh GitHub reads around 2026-10-04 17:30 UTC confirm the eight continuation PRs below are **open drafts and unmerged**. The provisional REST `merge_commit_sha` is not an actual merge commit. Fresh check-run reads at 17:33:52 UTC confirm `core` failed on every recorded head; the other eight returned checks per head were skipped. Pagination is complete for each endpoint's returned default-filter scope, not an enumeration of all historical attempts.

| PR | Branch | Exact published head |
| --- | --- | --- |
| [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) | codex/a09-string-reader | 0e7c56d8e9175ffad7c03dd7fd61ac0f1783b4a4 |
| [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) | codex/a09-string-writer | 2e6a7c5ba0eceaee24df8452ff54f098215eeef0 |
| [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) | codex/a09-string-reader-buffer | d46b27fd25a681cc675c63cff3d32bf5c26c867a |
| [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) | codex/a09-string-writer-object | d1499d108d127c9e1fcc6d37c0b4a0dd998feca7 |
| [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) | codex/a09-string-writer-buffer | 41a42061e3f647a4ea1f7c38937d55d7c62fc63d |
| [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) | codex/a09-string-writer-line-buffer | b7e6fdfba9d4847fbc9c3c2ae20e893525663e5d |
| [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517) | codex/a09-string-writer-char-line | 3493f1b49e849b05274fc910d4e1a7f993e22a38 |
| [#4542](https://github.com/wieslawsoltes/SharpForge/pull/4542) | codex/a09-string-writer-scalars | 16909aa003c61d63bcbe654cefda19e71f09d942 |

Each later publication head has the preceding head as its first parent; the oldest starts from main `00c2489e659cbeaa29e9c5dfa4a3137fae4bd4ad`. The eight draft updates preserve their existing branches and make the authored stack reviewable.

## Qualification retained separately from merge readiness

The local final tree `fe8288772be85395909d5de582c444db3d605ca3` replayed 278/278 tests; the measured product `f8414bfcadbab039280d580a8152ac21f9fe6452` passed static checks and fresh build, with 268 non-strict structure warnings. The recorded local package qualification covers 29 workspace tarballs and 45 offline smoke steps on Node v24.19.0. Performance review retained 15 median and 18 p95 exceptions, accepted by the independent Codex reviewer. These are exact local qualifications, not a human approval or current-main/hosted-core success claim.

The full original evidence is published at [immutable evidence commit c890bec08d53bf08295a36d67874a49f26672c8b](https://github.com/wieslawsoltes/SharpForge/tree/c890bec08d53bf08295a36d67874a49f26672c8b/evidence/project9/io-qualified). Large package/browser payloads are not duplicated into this small coordination bundle.

The actual clean source install failed because the root lock does not yet include the IO workspace/dependency entries. The retained original publication status includes each failed core job and the failed `npm ci` step; `io-clean-install-gate.log` records the local EUSAGE/missing-lock diagnostics. The fresh check-run artifact confirms current conclusions but does not newly retrieve those step logs. See `../root-package/` for the exact unapplied repair and active owner lock.

## Historical files are preserved

The exact copied `publication/README.md`, manifest and plan were authored before remote publication and contain “pending” wording. They are retained without rewriting. Use `io-published-status-fresh.json` for the fresh PR state and `io-checks-fresh.json` for the latest check conclusions. `io-published-status.json` records the completed publishing operation and original CI evidence.

All eight PRs remain drafts. No merge readiness is claimed until the root lock is legitimately reconciled and the exact updated stack passes the required clean-install/core checks. Broader #2723 remains open for its remaining acceptance.
