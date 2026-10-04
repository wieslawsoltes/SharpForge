# Explorer persistence lifecycle

`ExplorerPersistence({getData, onCommand, onWarning, onChange, environment, handles})`
composes the versioned recovery, stable physical identity, save-lock and revision
services. `observe(data)` schedules a bounded serialized checkpoint and independently
announces changed document hashes. The host must include current records, session
identity, tabs, dirty paths and physical disk attachment in its data snapshot.

Physical folders bind shared identity through `RecentWorkspaceHandles.identify`
using isSameEntry and Web Locks. Unbound workspaces with the same display name never
establish an editing channel. `ready()` resolves after the current folder identity
and locks have been installed; physical saves/operations must await it. Each window
has a separate OPFS checkpoint/receipt directory under the shared physical identity.

`saveReceipt` refuses persistent directory mutations when durable OPFS receipts are
unavailable. `checkpoint` serializes overlapping saves, retains unopened membership,
exact binary/text content and dirty/editor metadata, and reports interrupted receipts
without replaying their disk operations. `recent`, `recentFolders`, `reopenRecent`
and `requestPersistence` expose explicit host actions and permission outcomes.

Incoming revisions preserve the other buffer. `prepareConflict` and `resolve` read
the peer checkpoint and use the coordinator's exact hash/revision revalidation.
Selected content reaches the host through `onCommand('apply-conflict-resolution',
node, [], {resolution})`; the host must apply it as an unsaved buffer transaction.
Overlap or a newer peer notification remains visible through the warning callback.

`canReleaseDocument` protects unresolved conflicts. `releaseDocument` drops closed,
clean source bodies and merge baselines while retaining numeric revision/hash
watermarks. Queued earlier snapshots cannot reload evicted content. `dispose`
releases timers, channels, locks and records; asynchronous generation checks reject
publication from a replaced session.

This controller is composed by the dependent SolutionExplorer view and actual Studio
entry. Its focused tests use deterministic channel/OPFS-shaped services on Node;
they do not claim a browser component or multi-window UI qualification.
