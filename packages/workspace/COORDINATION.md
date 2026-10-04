# Cross-window document revisions

`WorkspaceRevisionChannel({identity, windowId, channelFactory, onRevision,
onPresence, onError})` publishes versioned presence and document-revision envelopes
on a workspace-scoped BroadcastChannel. The host supplies a trusted physical
identity; display names must not identify unrelated directories. The injectable
transport permits deterministic tests and explicit unsupported-environment handling.

`publishRevision({path, revision, hash, baseHash, resolution})` announces a SHA-256
revision. Received messages validate schema, discard duplicate/out-of-order sender
sequences and mark local revision metadata stale. They never replace editor content.
`dispose()` announces departure and releases the channel and document metadata.

`WorkspaceConflictCoordinator({getDocument, applyResolution, channel})` snapshots
local admission state when `observe(remote)` detects divergence. A caller chooses
`adopt-newer`, `keep-mine` or `merge`, then calls `resolve(path, choice, {readRemote,
signal})`. Remote bytes are rehashed, and local revision/hash plus intervening remote
notifications are rechecked before the host receives a selected result. One
resolution per path may run at once. A newer notification arriving during host
application remains a visible pending conflict after that admitted result finishes.

`applyResolution` receives exact bytes, the chosen content, expected local hash and
revision, and the new shared revision/hash. It must atomically validate and commit
the chosen buffer against those expectations. The library does not write physical
files; an unsaved peer adoption remains an unsaved editor change until explicit Save.
The dependent Studio session adapter provides that contract and UI choice dialog.

`mergeWorkspaceText(base, mine, theirs, options)` merges disjoint changes and returns
all three original texts for overlapping edits. Text is limited to 4 Mi UTF-16 code
units; line alignment is bounded to two million cells, then conservatively uses one
trimmed edit per side. `reconcileWorkspaceFile` requires an explicit choice. Distinct
binary changes cannot produce a fabricated textual merge; one side must be chosen.
Cancellation, malformed revisions and stale admission produce explicit failures.

This batch qualifies transport/coordinator contracts on Node using deterministic
endpoints. Browser multi-window UI and physical save-lock ownership are separate
dependent scopes and are not claimed by this contract batch.
