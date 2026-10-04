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

## Immutable prepared sources

Revision observation captures model-free immutable source roots and source/encoding
identity. Hashing yields between bounded encoded chunks; ordinary observation and
OPFS checkpoints do not read a prepared record's compatibility text getter.
Document-state Maps retain saved baselines in the version-two recovery envelope.

`WorkspaceConflictCoordinator` accepts optional `readLocal(document, options)`.
Only an explicit resolution invokes it, and its result must retain the observed
revision/hash. Existing stale-content guards and the 16 MiB content limit remain.
A resolved peer buffer remains unsaved until the host's explicit disk save.

The bounded JSON bundle export encodes immutable source records at the export
boundary and preserves sanitized startup configuration and launch-profile
metadata. Runtime arguments, environment values and grants are excluded.

The three prepared-persistence cases passed in the completed 228-file Node 22.23.3
source qualification at `5269d3970f10fee404ef23e5fe3d07cb61d8750c` (1,877 passed).
The original failed Node 26 run remains recorded independently; browser process
closure before assertions is not a browser pass.
