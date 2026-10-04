# Prepared workspace publication handoff

The prepared-source follow-up is published as four draft pull requests. Each
feature projection has exact Git blob equality with corrected source
`7b087e0f0e3105c71ec86e39554358766b45d3bf` and qualified source
`5269d3970f10fee404ef23e5fe3d07cb61d8750c`. The
[complete receipt and source ledger](workspace-prepared-publication.json) records
all actual parents, trees, individual feature blobs, ownership transfers and
qualification boundaries.

## Published feature layers

| Draft | Complete batch | Actual remote head | Exact tree |
| --- | --- | --- | --- |
| [#4299](https://github.com/wieslawsoltes/SharpForge/pull/4299) | Immutable record snapshots, exact encoded bytes and cooperative SHA-256 | `6fd9f56cd10dfa59fec1c348cf44fdf899f608da` | `741b075d09135968cc1747aec779416269e20c53` |
| [#4325](https://github.com/wieslawsoltes/SharpForge/pull/4325) | Journal/provider admission and exactly-once history after committed observer errors | `0f5515a30cd9aca987e088c55f5d7bbaa1e10e7c` | `d0af10b18c14beaec70a6f7b93b4ab827e32da88` |
| [#4339](https://github.com/wieslawsoltes/SharpForge/pull/4339) | Shared-root recovery envelopes and sealing the state actually adopted by the host | `8919b4626d6f7ea7e40623a969e1d44c62ba8d5b` | `1b7a7e7f3643d9623c0ff1e30cc0c9f487329d56` |
| [#4360](https://github.com/wieslawsoltes/SharpForge/pull/4360) | Lazy revision checkpoints, explicit conflict reads and portable bundle settings | `4bc8c86c42b8cea766f206f4ae3b0bb4c082923e` | `ce89ed7078a86644512da2a0afe7491eca717703` |

Five merge-only dependency branches connect actual previously published tips.
They preserve both parent contracts; none imports a whole canonical facade whose
private dependencies are absent. The final dependency includes the prepared
ProjectSystem prerequisite #4335, the original persistence #3601 and interchange
#3836. Archive metadata/destination APIs coexist with prepared path rebasing and
portable session settings. The Workspace class retains both lazy documents and
upstream semantic source queries.

The original map contains 26 owned drafts and 12 merge-only branches. These
follow-ups bring the owned totals to 30 drafts and 17 merge-only branches. The
forward correction of #4299 is one maintenance update of that same draft.
Neither publication counts nor helper ports claim additional issue completion.
All drafts retain merge-commit stack ancestry; no issue is auto-closed.

## Source and qualification

The completed synchronized scope passed **1,877 of 1,877 tests in 228 explicit
files on Node 22.23.3**, with zero failures, skips or cancellations. Its checkout
stayed clean. The manifest records the exact command selection, source before
and after, and SHA-256 hashes of the coordinator's raw TAP and JSON artifacts.
The 14 new package/persistence cases cover source encoding, journal ownership,
undo/redo, committed observers, recovery checksums/limits/adoption, deferred
content reads and portable metadata. The dependent native owner's five prepared
Explorer cases exercise actual provider effects and source admission.

The earlier Node 26 run remains recorded as **1,875 tests: 1,809 passed and 66
failed**. A shadowing variable in `workspaceStateSize` and an eager discovery
getter were corrected without weakening assertions. The intermediate affected
38-file replay passed the workspace assertions but still exposed a separate
application diagnostic problem. Those records remain distinct from the later
complete Node 22 pass. No per-projection runtime validation was repeated.

Current core/build/structure qualification is coordinated separately by root.
The source scope result does not assert that every projected stack, browser or
native platform passed.

## Browser failure isolated by a diagnostic probe

The component attempt at source `5269d397` terminated before its first assertion
while waiting for persistent folder identity. The root coordinator then ran one
bounded diagnostic probe at
`e9f8a8cd2ff1aa6506e9457a7591e3915e6e9f40` using Chromium **153.0.8010.12**, the
actual production HTTP/CSP harness, real browser APIs and an owned writable
`TMPDIR`. No isolated Explorer fixture was instantiated.

The probe passed OPFS byte write/read, fresh IndexedDB creation, ordinary
IndexedDB put/get and directory-handle put. **Reading that persisted directory
handle from IndexedDB terminated the browser with `SIGTRAP`.** Playwright's
`DEBUG=pw:browser` log records `exitCode=null, signal=SIGTRAP`. This isolates the
native browser failure boundary; it does not turn the incomplete component run
into an assertion failure or a platform pass. The subsequent `isSameEntry` and
separate Web Lock steps were not reached. OOM counters remained unchanged.

Probe artifacts are retained under
`/tmp/p18-final-qualification-logs/storage-probe-e9f8a8cd/`; their paths and hashes
are in the receipt manifest. This agent prepared the probe outside the repository
and did not execute another browser attempt. Native picker/permission UI and
non-Chromium engines remain outside this evidence.

## Ownership and application composition

The four command facades and prepared Explorer adoption bridge are published by
`workspace_inventory` in #4340, with the actual journal as the sole persistence
and undo engine. The minimal language union retains incoming source rename and
queries plus the type-preview API; native metadata-language #3900 remains a
separate dependency.

`portable_evaluator` owns prepared ProjectSystem/result #4335 and the provider
save, session, document-lifecycle and startup adoption projections. Any necessary
compatibility changes to the existing workspace-records/hydration helpers stay
with that session owner. This avoids copying those helpers into a second stack.

Root owns the protected production Studio composition and central acceptance
records. No proposed Studio entry was applied or executed by this agent. The
recorded helper and source qualifications do not substitute for that remaining
application composition or native/browser acceptance.
