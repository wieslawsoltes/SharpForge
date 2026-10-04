# Prepared workspace session ownership

`createWorkspaceSession(host)` keeps the established plain-host contract and
accepts `host.documents` with `host.workbench()`. That composition delegates
replacement to the incoming Documents/WorkspaceLoads owner. A load preserves
immutable source roots, baselines, dirty state and the explicit disk snapshot.
Superseded or cancelled preparation cannot publish records or dispose a model
that another owner has adopted. An error after adoption remains committed.

`workspaceContext(state, {documents, ...})` exposes model-free document state
and immutable source records without traversing compatibility text getters.
`workspaceSourceRecords` retains exact source/version descriptors; the existing
`workspaceDocumentStates` API remains unchanged. Explicit export is bounded and
retains sanitized startup configuration and launch profile metadata.

## Saves

Incoming `StudioSave` accepts the optional `saveWorkspace` callback. Its captured
record, model, source, target and workspace identities fence every awaited
permission and provider operation. The provider-backed callback delegates to
the existing conflict/permission/membership policy; ordinary Save As continues
to use the incoming streaming disk target. A later editor edit never replaces
the source captured for an in-flight save.

Conflict merge or take-theirs may commit a replacement document. In that case
the original DocumentService save reports false because its captured owner no
longer exists. The replacement owns its exact clean baseline; the old source
is never incorrectly marked clean. Physical or host effects that already
committed remain reported as committed even when a later notification fails.

## Closed documents and lazy input

Closed clean provider-backed documents are evicted through Documents.replace.
Dirty siblings retain their exact models, source roots, baselines and views.
The existing per-path cancellation, physical hash checks and compiler version
watermark survive eviction. Open, generated, read-only, unbacked or changed
records remain retained. The direct editor-disposal fallback is used only by
the established plain-host API without a document owner.

Lazy folders prepare only evaluation inputs and selected open sources. Recovery
can retain unloaded metadata until access is granted. Edited prepared sources
use fresh encoded length rather than stale original-byte metadata.

## Qualification and composition

All 13 product files match corrected canonical source
`7b087e0f0e3105c71ec86e39554358766b45d3bf` and final `5269d397`.
The shared Node22.23.3 run passed all 1,877 tests, including the 23 original
session/save/provider/policy/startup cases. Initial Node26 failures and the
unchanged-assertion correction replay remain recorded. The following small
qualification layer retains the original 19 remaining cases and real host
fixture; startup's four cases already belong to the policy prerequisite.

No test, SDK or browser run was duplicated for publication. The actual base
joins the published provider, prepared-record, recovery, Explorer, evaluator,
legacy session and policy contracts. Root owns the protected Studio entry and
its final application composition; this module stack is a draft dependency.
