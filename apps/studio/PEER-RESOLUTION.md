# Peer buffer resolution

`applyWorkspaceConflictResolution(host, session, resolution, options)` is the host callback for the
Explorer persistence controller's reviewed conflict result. It accepts text or exact binary content,
a local admission hash and a selected-byte hash. The workspace and document primitives are captured
before hashing, and identity, revision, versions, bytes, generated/read-only flags and native mode are
revalidated before the sole session commit.

The commit preserves membership and unrelated buffers, increments a safe document version and marks
the affected path dirty. It performs no provider writes and never advances physical baselines. An
explicit later Save-to-Disk owns disk conflict reconciliation and physical persistence. Selected UTF-16,
BOM and line-ending metadata are retained through the shared archive codec. Unloaded, generated,
read-only, missing, stale, hash-mismatched, oversized and exhausted-version inputs are explicit errors.

Options accept an AbortSignal and a bounded byte budget. The returned `{path, hash, dirty, revision}`
describes the accepted buffer. Existing journal history refuses an undo/redo plan after these newer
buffer bytes invalidate its prior state, preserving the peer edit. The dependent session/Studio wiring
supplies the actual atomic model commit and user choice; this callback alone does not claim browser
multi-window or native filesystem qualification.
