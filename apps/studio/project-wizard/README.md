# Project wizard composition

`ProjectWizard` keeps catalog selection, option state and rendering separate from
the pure template file plans. The public `project-wizard.js` facade exports the
controller and the explicit folder destination adapter.

The host supplies `context()`, the existing modal callbacks, `ask()`, and
`commitPlan(plan, options)`. Context includes the current workspace identity,
records, folders, project snapshot, startup project, solution path and native
platform capability. A changed identity invalidates an open preview before any
files are written. `showDirectoryPicker` and `confirmOverwrite` can be supplied
explicitly by the host; normal UI use invokes the picker from the Browse click.

The controller offers browser, connected native and selected-folder destinations.
Canceling a picker leaves the wizard open and creation disabled. Folder writes
preflight collisions and permissions, confirm the exact overwrite paths, and
retain the destination writer's rollback and partial-failure receipts.

`commitWizardDirectory(handle, plan, options)` returns
`{cancelled, writeResult, disk, directoryHandle}` after a successful write and
provider-backed reopen. `disk` is a `ProviderDiskWorkspace`, including byte
baselines, binary files, encoding metadata and lazy records for large folders.
Newly written paths are materialized even when unrelated existing files stay lazy,
so the generated project's source is available as soon as it opens.
If reopening fails, the thrown error retains `writeResult`; committed files must
not be reported as an untouched destination. A declined overwrite returns only
`{cancelled: true}` and performs no writes.

The host receives this attachment in the second `commitPlan` argument together
with `destination`, `add`, `kind`, `context` and `node`. It must attach the disk
workspace when opening the generated project and retain the original directory
handle. Later browser saves use the provider workspace's normal physical-identity
and `WorkspaceSaveLocks` coordination; that binding belongs to the Studio host.
The shared `studio.js` host is composed in its own integration change.

The portable attachment test covers byte-preserving reopen, subsequent encoded
and binary saves, cancellation and post-write open errors. The browser suite
covers the production controls, explicit picker cancellation, prerequisites,
project options, ZIP streams and real Chromium OPFS rollback. It does not automate
an operating-system folder dialog or qualify Windows App SDK execution.
