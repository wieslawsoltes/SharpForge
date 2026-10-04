# Workspace Save to Disk controller

`createWorkspaceSave(host, commit)` returns the asynchronous Save to Disk operation. The host supplies
current state and fresh context snapshots, persistence readiness, a native-save delegation, explicit
conflict choices, local checkpointing and status/render callbacks. `commit` is the application's atomic
record transition, used when a chosen disk or merged version must replace editor contents.

The controller snapshots original bytes and versions, checks every disk conflict before the first write,
and asks for keep-mine, take-theirs or a non-overlapping three-way text merge. Binary/deleted versions
remain explicit whole-version choices. A cancelled choice leaves the entire pending batch unwritten.
The observed remote digest becomes a save precondition, and all observed conflicts are checked again
before provider writes. Missing or overlapping choices produce a visible `SFW1411` conflict.

Workspace and physical disk identity are captured before persistence setup and checked after awaiting it.
Record identity, version and content are checked again after asynchronous digest work before clearing
dirty state. New edits made during a save remain dirty. A partial provider receipt reports exactly which
files were written; it does not declare the whole save atomic or discard remaining buffers. Failed merged
resolution receipts retain a retry baseline so a later save must review the changed disk again.

`promptWorkspaceSaveConflict(dialogHost, conflict)` escapes previews, limits preview text to 12,000
characters and disables unavailable text merges. Closing the dialog is cancellation. The production
application must bind this helper and the controller through its protected entry integration.

The controller projection tests use actual provider-backed directories with a small explicit host at the
callback boundary. Full `a24-save-conflicts` cases compose the real workspace session in the integrated
host cohort, covering all choices, binary/deleted files, cancellation, stale editors/disks, partial writes,
reentry and asynchronous identity/version races. Browser picker and OS qualification remain separate.
