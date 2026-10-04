# Workspace session boundary

`createWorkspaceSession(host)` owns workspace replacement, structural record commits, save, export
snapshots, recent-folder reopening and editor retention/loading/closing. The host composes rendering,
runtime stopping, import selection, compiler scheduling, persistence and the guarded save dialog.
`workspaceContext(state, options)` returns a fresh versioned record snapshot for commands and services.

`load(records, options)` prepares and validates the complete next project/folder model before publishing
it. Evaluation inputs and the selected/open editor sources may be loaded from the provider; other files
remain bounded lazy metadata. A newer load, source edit or cancellation while runtime stop is pending
invalidates the prepared replacement. Failed preparation retains the prior model, dirty state and recovery.

`commit({records, folders, mappings, restore, entry, dirty, diskSnapshot, diskCommitted, persistedPaths,
preserveMembership})` evaluates a staged model and rechecks the current workspace before publication.
Renames remap source tabs, active document, breakpoints and editors. Dirty paths are explicit, and a
physical transaction does not mark unrelated saved files dirty or clear unrelated unsaved editors.
`diskSnapshot` permits evaluation against an isolated metadata rescan before adopting physical baselines.

`loadRecord`, `closeRecord`, `retainRecord` and document release callbacks use the separately published
editor lifecycle. Source records preserve generated/read-only flags through loading and commits.
Permission-denied recovery retains loaded text and complete lazy membership in read-only mode; absent
bytes are never synthesized, and building/loading waits for explicit folder permission.

`snapshot()` materializes original lazy bytes before an export encoder can see them. The standalone
`hydrateWorkspaceRecords` helper has no compiler graph dependency. Save composes the reviewed physical
controller; its full-session cases cover text/XML/binary encodings, explicit reconciliation, partial I/O,
and identity or edit races during awaits.

The session foundation cases retain the original source test bodies and real host fixture. They cover
lazy admission, file-count limits, invalid replacement, resource-input hydration, structural state/dirty
remapping and permission-denied recovery. Runtime-stop races and full Save-to-Disk cases remain separate
focused files on this same session boundary. Production Studio entry wiring and browser/OS qualification
are owned by the application integration batch; package and callback tests do not establish those results.
