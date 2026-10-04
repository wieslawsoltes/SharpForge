# Workbench workspace action ports

`createStudioWorkspacePorts(host)` composes the existing workspace session,
archive, wizard, recovery and import services. Construction has no load or save
side effects. The host supplies its current `state`, `documents` owner, context
capture function and explicit UI callbacks. The protected Studio entry remains a
separate consumer of this module.

## Ownership and host callbacks

- `session()` lazily creates the existing workspace session with the host's
  `DocumentService`, workbench context, persistence, save-conflict and release
  callbacks. The session continues to own workspace admission and provider saves;
  Documents continues to own editor model adoption and disposal.
- `ensureSource(uri, {signal})` admits a closed C# source once. It checks cancellation
  and the captured workspace identity, revision and disk before model adoption.
  Prepared records keep their immutable source, model and encoding metadata; the
  compatibility `text` getter is not needed. Existing open documents are returned
  unchanged. Native sources delegate to the native controller's open operation.
- `recover()` delegates to the recovery bootstrap and preserves a blocked stored
  value. The host receives the existing diagnostic rather than an empty replacement
  workspace. `exportLegacy()` uses the prepared-record bundle serializer.
- `exportZip()` captures the current workspace after the save picker. The streaming
  export receives an ownership guard, so a changed workspace aborts an accepted
  writable sink. Picker cancellation returns `null`. `zipBytes()` provides the
  existing bounded in-memory fallback; `saveFolder()` uses the strict empty-folder
  writer and its truthful partial-write receipt.
- `openProject()`, `openItem()` and `commitWizard()` use the existing wizard and
  native context contracts. Read-only state rejects creation before a dialog or
  mutation starts. Loading an existing workspace entry retains its disk provider.

The `action(id, node, payload)` contribution table routes recent-workspace reopening,
disk external-change/re-evaluation, ZIP/folder saves, project entry opening, solution
conversion and existing-project import to these owners. `openZip()` delegates to
the prepared Blob importer. `previewFile()` admits the selected binary record and
provides a bounded byte preview or an image URL whose lifetime ends with the modal.
The host supplies user confirmation, dialogs, notifications and rendering; this
module does not create another document or native controller.

## Dependency and qualification boundary

The dependency branch joins actual published session/save, prepared ingress,
wizard, XAML, persistence, recovery bootstrap and disk-event host branches. Their
implementations are inherited from those parents, not copied into this feature.

The five direct cases in `tests/a24-workbench-workspace-ports.test.js` passed in the
corrected root Node 26 replay and the complete Node 22.23.3 scope at `5269d397`
(1,877/1,877 overall). The earlier four-of-five result is preserved: its failed
assertion read a private implementation field, and the corrected case now checks
the public live-model and owner-disposal behavior while retaining every metadata,
identity and lazy-read assertion. No projection-local tests or builds were rerun.
Protected Studio entry application and full browser flow qualification remain
separate from these public module contracts.
