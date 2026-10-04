# Prepared Studio composition against pinned main

The **proposed entry remains unapplied and unexecuted**. Its candidate bytes and 82 recorded text transformations
are unchanged. The actual canonical `apps/studio/studio.js` still matches pinned main
`1db2e1d540a78403b7aaddcf472311fcde1a81ef`; the root has built and browser-tested that actual entry with the
composed helpers. Those results do not qualify the proposed entry.

The reviewed source is `0bb2ed360a13f3cda3d990bd3f2ff4cebb8dd760`, tree
`7399d972ea939b8a5f05f894bc793f9b713cfd49`. Actual Release13 passed **all 16 checks**, with no page errors
and exit code 0. Product Node/build qualification belongs to `7d4c97d29ae847c5810376747f5a3ac682e2dfd1`,
tree `96cfc9d9dc5b1ddacdf4ce79a96bbfaf4e98cbdd`; only the browser fixture changed afterward. All 14
reviewed native/save adapter hashes match both sources and their earlier reviews. Protected ownership
must be reconciled before either prepared patch is applied. Earlier lease observations are retained as history;
the root confirmed both exact live claims at 07:27 UTC on 4 October 2026.
[The final lease and text-applicability record](protected-lease-readback.json) preserves both claims;
their recorded expiry is 20:04:09 UTC on 4 October 2026. Neither lease was changed.

## Concrete artifacts

- [studio-entry.patch](studio-entry.patch) contains every proposed entry change. The full candidate is identified
  by its exact SHA-256 below; no executable candidate file is included in this review subtree.
- [package-lock.patch](package-lock.patch) contains the separately prepared internal workspace dependency metadata.
- [entry-transformations.json](entry-transformations.json) records all 82 exact text transformations.
- [entry-metadata.json](entry-metadata.json) records candidate and base hashes, dimensions and the execution boundary.
- [entry-check.json](entry-check.json) retains the successful historical text applicability check and current source hashes.
- [entry-contract-review.json](entry-contract-review.json) records the native/save contracts and unchanged adapter hashes.
- [prepared-integration.json](prepared-integration.json) contains the patch inventory, qualification records, exact
  commands, source commits and original capture digests. Its absolute capture paths identify the authoring environment;
  they are not portable bundle-relative links.
- [prepare-studio-entry.py](prepare-studio-entry.py) is **historical authoring source**, retained unchanged. It contains
  original scratch paths and requires captured inputs outside this subtree. It has not been run during this refresh
  and is not a portable regenerator. The patch and transformation inventory are the concrete review artifacts.
- [historical-3ed2eb82/prepared-integration.json](historical-3ed2eb82/prepared-integration.json),
  [the historical entry patch](historical-3ed2eb82/studio-entry.patch) and
  [the historical lock patch](historical-3ed2eb82/package-lock.patch) remain byte-for-byte unchanged.

| Artifact | SHA-256 |
| --- | --- |
| Pinned and actual canonical entry | `4925930a42b705578a55c92d89ef8034a780baacec550325d834a992189424ab` |
| Proposed candidate | `6f37a3e450a5ab39bb10143156502f993b5c0a80bb844f8b6823e9a7589d196b` |
| Proposed entry patch | `8a0a5cb607783640d401275b4b847fac14ca513250c38f4989290e9fd0c794d3` |
| Proposed lock patch | `6d4f519722d45f06baff5c27b74d3f8ca6fa1443b4ecf4deda0afba70f5e1985` |

The candidate is 91,407 bytes versus pinned main's 104,693 bytes, a reduction of 13,286 bytes. Both contain 748
physical lines; the structure check counts 749 split-lines against the frozen allowance of 751. The longest
candidate line is 2,140 characters, below the frozen allowance of 6,074. New workspace orchestration lives in a
formatted module; existing code was not minified to meet the limit.

## Composition decisions

| Area | Preserved upstream owner | Project18 contribution |
| --- | --- | --- |
| Workspace loading | `WorkspaceLoads`, `DocumentService.replace`, prepared-source ingress | Session load/commit delegates through the workbench-aware facade; provider identity, recovery state, encoding and closed records remain part of the transaction. |
| Save | `StudioSave` captures and coordinates exact document/model targets | Optional `saveWorkspace` delegates captured saves to the existing provider save/conflict engine. |
| Build and launch | `StudioProjects`, `BuildService`, BuildQueue and LaunchOrchestrator | Structured project compiler requests, selected-context options, closed dependency artifacts, program arguments/environment and debug source provenance enter through contributions. |
| Navigation | Existing tab policy, split views and one shared navigation history | Source admission occurs before the original location opener; the optional navigation preparation hook admits an evicted target before replay. |
| Debug sources | Each AppSession and existing session breakpoint controller | Qualified dependency source identity drives navigation, cursor commands, source matching and breakpoint binding. Workbench diagnostics from every producer remain visible. |
| Native context | Lazy native feature and workbench Documents | Context/test callbacks pass through; generated files remain readonly; selected-context and refresh helpers adopt through Documents. Dirty source collection uses captured sources. |
| Designer | Upstream designer diagnostics and source synchronization | XAML edit callbacks enter through the source-format seam; closed-file and stale-generation guards remain enforced. |
| Archive and wizard | Existing import load ownership and transactional Explorer commands | Blob ZIP import stays in the incoming import helper; writable ZIP export, original encoding, destination receipts, wizard startup selection and native context update reuse their completed services. |
| Recovery | Existing startup composition and asynchronous workspace session | Blocked recovery preserves storage and suppresses sample replacement; sanitized application/session settings survive interchange. |

`apps/studio/workbench/studio-workspace-ports.js` contains the extracted action/session wiring with explicit host callbacks. It creates no second document controller. Its source-admission boundary checks cancellation and workspace identity/revision/disk before adopting a prepared model. Writable ZIP export captures the workspace after picker completion and transfers sink ownership to the bounded archive writer. The action registry uses the actual Explorer IDs: `reopen-recent-workspace`, `disk-external-change`, and `disk-reevaluate`. Conflict resolution uses `applyConflictResolution` and the existing `(host, session, resolution)` contract.

## Required unlocked source composition

This entry proposal depends on the canonical helper source's published ports. They are not all present in pinned main alone:

- Owned build/project execution: `workbench/build.js`, `sessions.js`, `studio-project-compiler.js`, `studio-projects.js`, and `studio-execution.js`.
- Owned lazy callbacks: `workbench/lazy-features/{designer-configuration,native-configuration,facades}.js`.
- Owned debug provenance: `workbench/{app-session,session-breakpoints,launch-orchestrator}.js`, `debug-source-breakpoints.js`, and `debug-editor-decorations.js`.
- Owned workspace extraction: `workbench/studio-workspace-ports.js`.
- Native owner's `native-build/workspace-state.js` Documents bridge and `native-build/explorer-refresh.js`.
- Evaluator owner's workbench-aware workspace session/save/lifecycle, intrinsic document locks and session provenance state fields.
- Workspace owner's descriptor-preserving records, persistence/recovery, async startup and closed Explorer document admission.
- Root's streaming file-import and navigation preparation seams.

No root package manifest or lockfile changes are included in this patch. The manifest composition is a separately held root artifact.

## Qualification and remaining execution boundary

The proposed entry passed **text applicability only** in the historical `git apply --check`. Its patch has not
been applied, parsed through Node, built or opened in a browser. Hash comparison during this metadata refresh
confirmed the actual canonical entry is still identical to pinned main. No test, build, browser run or candidate
execution was launched for this refresh.

The root's completed-scope evidence is recorded separately:

| Exact source | Scope | Result |
| --- | --- | --- |
| `5269d3970f10fee404ef23e5fe3d07cb61d8750c` | Full 228-file Node 22.23.3 scope | **1,877/1,877 passed**, zero failures, skips or cancellations. |
| `e9f8a8cd2ff1aa6506e9457a7591e3915e6e9f40` | 18-file legacy cleanup on Node 26.10.0 | **382/382 passed**; check, build and clean-checkout passed. |
| `362f1337870ca5dca302ab7dc0dfc9f58629523f` | Editor ownership and selection adapter on Node 26.10.0 | **40/40 passed**; check, build and clean-checkout passed. |
| `362f1337870ca5dca302ab7dc0dfc9f58629523f` | Actual canonical Release13 browser run | **3 checks passed**, then source-input failed because the obsolete `.fill` fixture did not replace the virtual editor document. Suite incomplete. |
| `7d558dab613acfbcdcc46893ad5f8ff549756e4c` | Actual canonical Release13 with keyboard/selection fixture | **5 checks passed**, including source input and undo/redo; shortening the document then exposed a stale status-column `RangeError`. Suite incomplete; the subsequent status correction is qualified below. |
| `886fb139fc647f0532085b5a0866a498fa7fca52` | Status-position correction and retained qualification files on Node 26.10.0 | **43/43 passed**; check, build and clean-checkout passed. |
| `886fb139fc647f0532085b5a0866a498fa7fca52` | Actual canonical Release13 after the status correction | **10 designer checks passed**; the retained event-handler/UI launch case then timed out waiting for `debug.uiActive`. Suite incomplete. |
| `886fb139fc647f0532085b5a0866a498fa7fca52` | Read-only runtime-session diagnostic capture | Captured nested `TypeError: Illegal invocation` at `ExecutionCapture.wake`, inside workbench event `AggregateError` delivery. `runtimeReady` remained false; this is failure evidence, not a passing runtime test. |
| `2ecaddeda1c3f26b76f53b5039f54137782f5cd1` | Capture timer regression negative control | **0/2 passed, 2 failed** before the correction; expected red evidence retained. |
| `de9a5e8fe2320a5e2e5cdc56d4752def50bd9d04` | Capture timer correction on Node 26.10.0 | **11/11 passed**; check, build and clean-checkout passed. |
| `de9a5e8fe2320a5e2e5cdc56d4752def50bd9d04` | Actual Release13 after the capture timer fix | **10 checks passed**, no page errors; launch still returned a worker timer error. Historical failure retained. |
| `2db6a9ac38eddd5ed83f1a747a8a226266bab8e8` | Runtime timer regression negative control | **0/3 passed, 3 failed** before the correction; expected red evidence retained. |
| `7d4c97d29ae847c5810376747f5a3ac682e2dfd1` | Runtime timer correction on Node 26.10.0 | **34/34 passed**; check, build and clean-checkout passed. |
| `7d4c97d29ae847c5810376747f5a3ac682e2dfd1` | Actual Release13 before the worker-ownership fixture correction | **15 checks passed**, no page errors; the obsolete lifetime worker-count assertion failed. |
| `0bb2ed360a13f3cda3d990bd3f2ff4cebb8dd760` | Actual Release13 with live worker ownership checks | **16/16 passed**, `errors: []`, exit 0, over CSP HTTP and real workers. |


The legacy strict structure command still exited 1 for 265 inherited violations, down from 268. It reported no
new or worsened violations; all seven actual legacy growth cases were removed without expanding the baseline.
The initial synchronized Node26 result (1,809 passes and 66 failures out of 1,875) and the affected replay
(259 passes and one failure out of 260) remain historical evidence. Later green runs do not rewrite those results.

All four new owned fixtures are included in the passing `5269d397` scope, and their exact source bytes still
match the reviewed helper source:

| Fixture | Passing cases |
| --- | ---: |
| `tests/a24-workbench-project-composition.test.js` | 7 |
| `tests/a24-workbench-feature-callbacks.test.js` | 4 |
| `tests/a24-workbench-debug-provenance.test.js` | 4 |
| `tests/a24-workbench-workspace-ports.test.js` | 5 |

The related diagnostic producer (5), XAML reopen (3) and runtime input (3) cases also passed there. These are
helper and public-contract results. Full proposed-entry execution and Windows-only native target execution
remain unqualified. **The actual canonical Release13 suite is complete.** Its source/designer edits, retained
event handler, animation clocks on source/direct-CIL workers, and live worker ownership checks all passed.
The `7d4c97d2` failure counted every worker ever created and required exactly two. The fixture-only follow-up
checks the incoming workbench's live compiler/application owners, worker identity, disposal and churn; it
does not relax the no-page-error or worker-ownership requirements. The Git diff and recorded equivalence
proof contain only `tests/browser_release13_test.py`, so no product rebuild or Node rerun was needed.

Storage and Explorer/corpus browser acceptance remain distinct. The earlier primitive probe completed OPFS
and plain IndexedDB operations but crashed during stored filesystem-handle retrieval; handle identity and
Web Locks were not reached. Release13 does not qualify picker, recent-handle restore, final Explorer/corpus
flows or other browser/platform cells. The root completed a fresh lease readback and successful text-only applicability checks before
copying this review staging. The protected proposals remain unapplied and unexecuted.

## Published source ports

The four complete port units are published as drafts with actual dependency ancestry and source/tree receipts:

| Unit | Draft PR | Published head | Required core |
| --- | --- | --- | --- |
| Project build and execution | [#4326](https://github.com/wieslawsoltes/SharpForge/pull/4326) | `6863a10cbf07d5d2a412afe3b8f231de9f260902` | Passed |
| Lazy designer and native callbacks | [#4328](https://github.com/wieslawsoltes/SharpForge/pull/4328) | `e76d3b000d164217bfc800d5fa9ae00715d869ff` | Passed |
| Session debug provenance | [#4363](https://github.com/wieslawsoltes/SharpForge/pull/4363) | `8cb83f2a70abf3327032b2a506ced9d03f571c18` | Passed |
| Workspace action and session ports | [#4407](https://github.com/wieslawsoltes/SharpForge/pull/4407) | `c542f4f62c0565686637a037e5cb2fef0eed75d1` | Passed |

The proposed entry remains a separate review artifact until the root coordinates its protected application
boundary. No main merge, protected entry write or lease mutation is part of this metadata handoff.
