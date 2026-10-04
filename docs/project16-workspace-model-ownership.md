# Workspace model ownership correction

Work IDs: SF-A19-T01.3, SF-A19-T12.1, SF-A20-T01.

The hosted browser run `a3` at public commit
`e4629f443b59bfc2d7494b731be19afc5974b7b1` failed while replacing the default
workspace. The multi-session fixture reported `Workbench event listeners failed`
from `StudioProjects.removeMembership`; the workflow wizard displayed the same
error. These remain failed browser executions.

The nested exception was reproduced in one bounded Node diagnostic with the real
`CodeEditor` disposal method, `DocumentService`, `StudioProjects`, `EditorModel`
and `DocumentLocks`. Inert input/paint surfaces and the existing fake worker
provided the host boundary. The first diagnostic attempt stopped before the
scenario because Node has no browser `Worker`; supplying that existing worker
adapter allowed the same scenario to run. This was diagnosis, not a browser pass
or the completed corrective validation cohort.

`DocumentService.replace` installs the replacement model registry before releasing
old views. `CodeEditor.saveViewState`, called by old-view disposal, previously
inserted the old model into the shared registry again. Planned cleanup disposed
that old model, but the registry still referenced it. `DocumentLocks.apply` then
threw `EditorModel is disposed` during both reset and membership notifications.

View-state saving now respects the registry's exact model identity and never
mutates model registration. Cached selections, bookmarks and change tracking
belong to the particular model that produced them. A superseded view cannot
overwrite the replacement's shared folding cache. Normal switches and standalone
view disposal still save current view state and retain live session-owned models.
The shell also ignores an obsolete editor when reading the replacement document's
cursor context, so old offsets cannot be applied to a shorter new source while
workspace notifications are still being delivered.

Focused regression files:

- `tests/a19-studio-model-ownership.test.js`: actual loader/service/editor disposal,
  shell subscriptions and status callbacks for removed and same-URI replacements;
  genuine listener failures remain aggregated and visible.
- `tests/a20-editor-view-ownership.test.js`: ordinary switches and disposal,
  removed-model cache ownership, external replacement and explicit standalone
  replacement at the same URI.

The shared fixture uses production lifecycle/model methods with inert DOM paint
and input surfaces. It does not claim browser layout, focus, file permission or
large-file latency qualification. The complete focused cohort and hosted retry
are pending integration; no tests or builds were run after this correction.
