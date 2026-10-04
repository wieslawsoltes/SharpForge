# Project 19 delivery and qualification scope

[The delivery matrix](../../../planning/project19-delivery.json) maps every issue in the
October 3, 2026 Project 19 snapshot to source files, acceptance fixtures, remaining evidence,
platform targets and observed ownership records. It contains **111 issues: 3 epics, 11 tasks
with native children and 97 leaves**. Of the leaves, **96 are implemented and #2157 is
partial** because the benchmark CI binding remains pending. T11 overlaps T20–T22; its
native E02 parent is retained without counting a second implementation of the same
collaboration features.

This metadata refresh inventories integration commit
`29b9d5e28857f7ef3759f3899128d46baab7901b`, tree
`1ebfc74de824609b8f7807813c2d6441098b7f71`. It also records selected existing qualification
results, each bound to the historical source that actually ran. **An implemented path, an
authored fixture, an executed check and full issue acceptance are separate states.** These
observations do not certify the full current integration head, and all issue-closure flags
remain false. Root owns the serial gate and the full command, artifact and platform ledger.

## Implemented families and authored evidence

| Scope | Source boundary | Defined acceptance fixtures |
| --- | --- | --- |
| T01, T13 | Object formats, SHA1DC/SHA256, codecs, ODB, refs/config, service/worker | Native objects/index/refs, 50k-object IndexedDB reload, OPFS worker and lifecycle/cancellation, revision and shallow traversal |
| T02 | Framing, protocol v0/v1/v2, fetch, packs/IDX2, shallow/promisor, clone journal, HTTP/proxy, REST snapshots | Native advertisement captures and fragmented roundtrips, forced protocol versions, incremental object counts, full refs, native depth-50 deltas in both formats, ten worker-termination checkpoints |
| T03–T04 | PAT/device/PKCE/App/broker, origin grants, vault, scope evidence, lifecycle and redaction | Auth server fixtures, recipient isolation, actual IndexedDB credential-row scan/reload, artifact scans, logout races, exact one-attempt unknown-scope consent |
| T05 | Index/worktree, ignore/attributes/EOL, status, staging, commit and signing | Native DIRC and porcelain, 300 ignore decisions, native add/rm/mv/reset/intent-to-add and interactive patch editing, fixed-ID commits, SSH allowed-signers |
| T06 | Pack writer, receive-pack, force/lease, remote configuration and refs | Native strict pack acceptance, delta-size assertions, actual HTTP push, concurrent stale-lease rejection, refspec dry-run, deletion/prune and ahead/behind comparisons |
| T07 | Checkout/branch, graph, merge/rebase/sequencer, stash/reset | Forty native graph shapes, generation-assisted merge-base, 100 merge-file scenarios, 17 conflict-index shapes in both directions, native replay/reset and bidirectional SHA1/SHA256 stash |
| T08 | Diff/history/blame, graph layout and Studio views | 150 native diff pairs, 36 rename-threshold cells and 36 advanced blame scenarios, graph snapshots, actual Studio workflow, Chromium status timing and highlight-constructor coverage |
| T09, T14, T16 | LFS, trusted nested repositories, sparse checkout, GC, ZIP and bundle | Stateful clean/upload/pushed-pointer/download sequence, isolated default child adapters with pin trust and rollback, native sparse status, fifty actual HTTP fetches before GC, native bundle/archive |
| T10, T19 | Provider PR/issues/checks, snapshots, settings and identity | Official-schema provider fixtures, canonical PR tracking checkout, current-branch create and returned URL, exact-source review annotations, snapshot CAS/source-record adoption |
| T12, T17–T18 | Execution policy, fsck, CLI, differential/fuzz/performance harnesses | Native refs/index/worktree/fsck, one-million-mutation harness, 100 MiB pack heap profile, 100k-file/1 GiB benchmark and profile-matched regression comparator |
| T11, T20–T22 | CRDT, authenticated transport, presence/persistence and editor adapters | Independent three-replica 10k model, native Node WebSocket, actual editor events/cursors and two-browser-context reconnect/reload |

The matrix contains the exact leaf-to-file mapping, including implementations whose names
differ from the issue's suggested layout. Parent records aggregate their actual children;
they do not replace leaf evidence.

The native shallow fixture follows depth 1 → deepen 10 → absolute depth 16 → shorten to 4 →
unshallow to the complete 20-commit history in SHA1 and SHA256. It compares canonical
objects and traversal boundaries even when older objects remain locally. The native
partial-clone fixture compares a real `blob:none` fetch, retained native pack membership,
one deduplicated checkout hydration batch, files/index/status and preserved `FETCH_HEAD`.
Received objects are loose in the implementation; native Git's physical pack layout is
not claimed to be identical.

## Selected executed qualification

The matrix retains full commit and tree identities for these root-managed stage records.
Counts describe checks within the named stage; they are not a sum of all project tests.
Browser observations below use Linux Chromium and do not qualify Firefox or WebKit.

| Stage | Source commit | Recorded outcome |
| --- | --- | --- |
| 007, pack memory | `d858578e52a2` | Passed full-size PACK decoding and native Git verification |
| 013, browser storage | `5ec2a6583198` | 10 checks passed, including 50k-object IndexedDB reload and quota rollback |
| 030, Studio | `b37c53149243` | 10 checks passed with actual workers, IndexedDB, history, merge and blame views |
| 032, history graph | `597d9a46acea` | 4 checks passed with 10k real commits and the production renderer |
| 035, direct WebRTC | `2c7741b89995` | Runner failed; native channel establishment was environment-blocked |
| 037, WebSocket fallback | `0e5f1b5ed893` | 12 checks passed within the fallback scope; `fullScopePassed: false` |
| 041, status performance | `d69eed5c30cc` | Failed the team's Node 10k-file cold and warm engineering targets |
| 044, canonical clone | `d69eed5c30cc` | 3 browser checks passed: public clone, private authentication and declined grant |
| 048, status performance | `ccc2b5cf49ba` | Failed the team's Node warm engineering target; cold passed |
| 050, collaboration performance | `29b9d5e28857` | Passed Node correctness, latency collection and separate native allocation sampling |
| 052, full large-repository benchmark | `29b9d5e28857` | Failed with `ENOSPC` while generating binary files, before any operation measurements |

Stage 007 recorded a 104,867,232-byte PACK and sampled peak V8 `heapUsed` of **14,803,312
bytes**, below the 64 MiB heap target. Peak RSS was **85,319,680 bytes** and is reported
separately from heap, external and ArrayBuffer memory. Sampling can miss transient
synchronous peaks; the measurement is not a claim that total process memory stayed below
64 MiB.

Stage 032 observed **59.506 fps** with a 60 fps target, an explicit minimum of 59 fps and
1 ms timestamp tolerance. Its p95 frame interval was 16.8 ms, with at most 20 live history
rows. The scoped gate passed; this is not an exact 60 fps result on every browser.

The 10k-file status budgets of **500 ms cold / 50 ms warm** are **engineering targets
introduced by this implementation team**, in test commit `593b5571` and documentation
commit `76208538`. They are not numeric Project 19 issue acceptance criteria. The earlier
documentation's acceptance attribution was incorrect.

Stage 048 remains a **failed engineering benchmark**: Node cold/warm medians were
**365.818/63.194 ms**, so cold met the budget while warm exceeded it. Memory-worktree
medians were **233.128/20.329 ms**. The earlier stage 041 recorded Node
813.434/78.314 ms and Memory 323.756/19.536 ms; its failure remains in the ledger.

The distinct **#2142 issue requirement** is a status-bar update within **500 ms** after a
commit. Stage 030 measured **25.1 ms** from the trusted Commit Staged click to the clean
branch-indicator mutation and passed that requirement. It also includes the native
Chromium highlight-constructor coverage check. Two actual source edits first
establish that coverage observes the constructor; blame toggles then preserve text,
selection and tokens without invoking it. Stage 044 uses real `git-http-backend` over
explicit loopback HTTPS/CORS: public clone loads the solution with canonical OIDs, a real
private 401 opens the PAT dialog and retries successfully, and declining an origin grant
issues zero requests while preserving the workspace.

Stage 035 recorded no local or remote ICE candidates and `uv_interface_addresses` errno 1.
Its environment-blocked classification is not a product pass. Stage 037 separately
qualifies native WebSocket delivery, two-context editing and cursors, offline/reload
convergence, isolation, cancellation, disposal and CSP. Native ICE/DTLS/SCTP remains
unqualified.

Stage 050 ran the Node JavaScript RGA/AVL backend on **Node v24.19.0 / V8
13.6.233.17-node.51**, Linux x64. Its **20,000 unprofiled warm edit/anchor samples** recorded
a **0.010055 ms median** and **0.039459 ms p99**. A separate allocation pass repeated
creation, editing, snapshot/encoding and disposal with a 32 KiB V8 sampling interval.
It estimated **337,698,304 bytes** across the isolate and **313,083,088 bytes** attributed
to collaboration source stacks. These are sampled allocation-traffic estimates, not
exact totals, object counts or per-edit allocations. The raw profile and its SHA-256
identity are retained; native/external memory, browser and network latency are outside
this measurement.

## Integrated follow-ups and evidence boundaries

Checkout prefetch and authorized promisor hydration, generation-assisted merge-base,
visible missing-LFS state, default isolated submodule storage, exact path/URL/pin trust,
offline and maintenance tools, PR checkout/create/review annotations, and request-local
unknown-PAT consent are integrated at the inventory source. The earlier assigned code gaps
for those paths are removed from the matrix. Known-insufficient token scopes still reject;
consent is not stored as evidence of a token's scopes.

The following distinctions remain explicit in the inventory:

| Requirement or boundary | Authored or executed scope | Evidence still pending |
| --- | --- | --- |
| GitHub recorded fixtures, #2150 | Actual PR #3635 creation/GET and positive/empty normalized review selections retained in `a29e2d5a` | Replay execution; HTTP/GraphQL envelopes and insufficient-scope denial remain authored |
| Other provider recorded fixtures, #2097 and #2151–#2152 | Hand-authored official-schema fixtures | GitLab, Bitbucket, Azure DevOps and Gitea capture provenance |
| File System Access, #2064 | Directory adapters, native Node interoperability and stage 013 OPFS-backed handle checks | CLI-cloned OS folder → correct Studio status → Studio commit → native `git log` |
| Large benchmark, #2157 | Full runner and exact-profile 20% comparator; stage 052 attempted the full profile; inactive workflow proposal | Complete measurements after the ENOSPC failure, baseline review and authorized CI registration |

The recorded-provider gap concerns fixture provenance. It does not impose continuous
live-account CI or provisioned OAuth broker deployments as new acceptance requirements.
The GitHub follow-up retains selected actual connector/REST fields, not raw transport
captures; [its provenance notes](../../../tests/fixtures/a25-providers/README.md) identify
the normalized representations, authored envelopes and denial-policy inputs. Its authored
replay tests are not recorded here as passed. The broader inventory source predates this
capture follow-up; the named commit identifies the additional evidence.
Stage 013 explicitly identifies its directory source as `opfs-test-handle`; it cannot
establish the combined OS-folder criterion for #2064.

Stage 052 **attempted the full 100k-file/1 GiB binary benchmark** and exited 1 with
`ENOSPC` during `generate-binary`. Its retained report has `complete: false`, `ok: false`
and an empty `measurements` object; it is not a baseline. Another run needs adequate
storage, not a provider account. A successful candidate needs review of its exact source,
profile, machine and measurements before use as a regression baseline. That review may
be performed by a peer agent; neither #2157 nor CONTRIBUTING imposes a human-only
baseline approval. Stage 050 supplies the dedicated Node allocation measurement for
#355; retained-heap deltas remain separate and direct WebRTC remains blocked above.

## Concrete CI-owner handoff

[qualification-workflow.yml](qualification-workflow.yml) is an **inactive proposal**
under package documentation. It changes no registered workflow, trigger or shared CI
behavior. The CI owner can register it as `.github/workflows/a25-git.yml` after coordinating
the completed-scope validation slot. It uses the repository's pinned checkout/setup/upload
actions, Node 24.21.0 and Python 3.12, one Ubuntu 24.04 job, and serial Node, full 100 MiB
pack, full 100k-file/1 GiB benchmark and native Chromium browser stages. Direct WebRTC
remains required in the full browser stage; the separate fallback run is not its substitute.
Available reports and failure logs are uploaded with `always()`.

The manually selected `candidate` mode supplies no regression verdict. `regression` mode
requires a tracked `packages/git/bench/baselines/*.json` from a complete successful
measurement and passes `--baseline` plus `--require-baseline`; the runner fails on a
greater-than-20% comparison. Retain the original qualification report/source identity and
the peer's review alongside a selected baseline, and compare equivalent hardware and
profiles. Do not invent values or compare a run to itself. The proposal's 12 GiB free-disk,
6 GiB RAM preflight and 240-minute ceiling are provisioning guards, not measured resource
requirements or issue acceptance thresholds. The owner must allocate adequate capacity;
the proposal never deletes unrelated files to obtain it.

The existing package registry exposes explicit local `node`, `pack-memory` and `benchmark`
stages. Area manifests register Node and Python tests, not arbitrary benchmark commands;
they provide no explicit hosted benchmark registration without a workflow change. No
label or environment variable secretly adds this expensive benchmark to existing tests.
The existing manually dispatched `merge-queue.yml` does discover A25's browser manifest
and can run its storage, Studio, collaboration and clone wrappers. Its manual impact plan
selects all areas, however, and does not run this benchmark or upload these result artifacts.
The fixed central `full-ci` browser matrix is not that A25-manifest route.

Targets without a selected result here, including the one-million-mutation gate and
100 ms cancellation target, require their separately recorded qualification evidence.
A MessageChannel cancellation assertion alone is not native browser-worker timing proof.

## Capability boundaries

REST metadata adapters expose `canonicalObjects: false`; snapshots cannot promise original
signed commit bytes and OIDs. GitHub provides GraphQL `beforeOid` CAS, Azure per-ref
`oldObjectId`, while GitLab/Gitea have weaker file guards and Bitbucket lacks CAS. The
service surfaces these differences. Snapshot submodules and some provider file modes are
explicitly unsupported. OpenPGP signing requires a registered key-provider extension.

Linked-worktree `.git` indirection needs an explicit common-directory adapter; alternate
ODBs require grants. Browser directory adapters do not claim native executable, symlink or
OS lockfile guarantees. The reference collaboration journal has one owner and no tombstone
GC. STUN/TURN, provider, LFS and proxy recipients require separate connection grants.

## Ownership and serial qualification

The read-only ref audit at **2026-10-03 21:27:41 UTC** observed **11 A25 claim refs**, all
under T01 and held by this team. No competing A25 ref was observed. Absence of a ref does
not establish Ready status or exclude a legacy field-only owner: Project field projection
was unavailable through the connector. The audit certified no additional safe claims and
changed no remote refs. These are dated observations, not refreshed lease assertions.

The `studio` and `package-json` locks were associated with the team's T01 claims.
`ci-workflows` was held by **SF-A00-T10.4 / codex-p4-planning / codex/a00-review-gates**.
Preserve that independent ownership; expiry is not release. The matrix retains the
observed generations, expiries and ref commits.

A separate read-only ref check on October 4 confirmed the CI lock at
`29cd6c4956c57bd4a39acecf0f5d6d59620792b4` and its claim at
`d06b86ba5169e8148c3b492bbc9c4e70e91377c7`, with expiry
`2026-10-04T23:59:59.999Z`. `planning/contracts/locks.json` maps `ci-workflows` to
**`.github/workflows/**`**, including new filenames. The current owner must register the
proposal, or explicitly release/reconcile the reservation before a new owner acquires it.
This coordination requirement is distinct from baseline review. The proposal is not an
executed workflow, #2157 remains partial, and its issue-closure flag remains false.

Follow [the serial validation policy](../../../planning/qualification/serial-validation.md).
Root owns one bounded local or hosted qualification slot at a time. Focused Node runs use
`node scripts/limited.js node --test ...`; browser/native/performance families retain
source trees, tool versions, commands and failures independently. No aggregate passing
claim or blanket issue-closing statement follows from these scoped observations.
