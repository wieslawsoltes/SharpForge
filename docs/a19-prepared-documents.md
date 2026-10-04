# Prepared document ownership and snapshot saves

The A19 document owner accepts the prepared records produced by the editor's chunked source reader. The disk and project-system layers preserve property descriptors until this adoption boundary. They must not spread a record or read its compatibility `text` getter while preparing a workspace.

## Adoption contract

A prepared record supplies `path` or `uri`, a matching version, `model`, `source` and optional length, byte length, encoding and BOM metadata. The model must expose the matching URI/version and the same immutable snapshot as `source`. The reader creates the model; `DocumentService` adopts that exact instance and snapshot without rebuilding the buffer or materializing text. `model`, `source`, `originalSource` and length remain nonenumerable on adopted records. The public `text` and version properties remain compatible with existing callers; text is lazy and edits continue through the model owner.

`replace(records, options)` validates the entire batch, creates any missing models, subscribes staged models and prepares reversible saved markers before changing the workspace. Duplicate URIs, stale source/version pairs, invalid records, cancellation and factory/subscription failures leave the existing workspace intact. Models supplied by the caller remain caller-owned on precommit rejection. Models created by a failed document factory batch are disposed. Live read-only models may be retained without changing their lock.

Ownership transfers at one commit point. After that point, the document/model maps are authoritative even if a view refresh or old-view cleanup fails. Such failures have `code: 'DOCUMENT_COMMITTED'` and `committed: true`. The caller must complete its corresponding workspace metadata update and must not dispose newly adopted models. `documents.ownsModel(model)` identifies models whose ownership transferred. Cleanup attempts every affected view and model even when one callback throws.

`add(record, {dirty, signal})` uses the same staging and ownership rules for one document. The legacy `files.push(record)`/`get(uri)` path also adopts a prepared model without a text copy. Disposing the document owner releases owned models, view state and retained source baselines.

## Append imports and dirty models

`replace` defaults to `preserveDirty: false`, suitable for an intentional workspace replacement. An append import passes `preserveDirty: true`; only models identical to those already owned retain their saved baseline, undo saved marker, dirty state and any stale-save marker. New or replacement models begin with a fresh baseline. Without `discard: true`, removing or replacing an unsaved model still fails with `DOCUMENT_DIRTY`.

The host passes `preserveEditors: true` when retained views should be rebound to the committed document map. It also supplies the desired `tabs` and `active` URI. Keeping an identical model preserves shared undo history while each editor view retains its own selection and scroll position.

## Captured save records

`documents.captureSave(uri)` returns a frozen record with a captured version and nonenumerable immutable `source` and length. Encoding, BOM and provider metadata are retained. The record has no mutable model reference. Its enumerable `text` getter reads the captured source only if a legacy provider requests it. Plain documents without models retain the existing captured-string contract.

`documents.save(uri)` runs the active editor's `prepareSave` hook before capture, awaits the registered provider and then calls `markSaved(uri, captured)`. Bulk disk saves can prepare their editors, capture each document with `captureSave`, pass `{uri, source, version}` to the streaming provider and pass the full captured record to `markSaved`. No source-path code destructures the lazy `text` property.

A successful save marks only the exact captured current model revision clean. When the model changed during I/O, the written source becomes the saved baseline and the document stays dirty; neither the captured nor current source needs flattening. If the workspace replaced that document while I/O was pending, the old completion cannot mark its replacement clean. Failed writes leave the prior baseline unchanged.

## File-operation state

`documents.captureState(uri)` captures `{uri, version, source, baseline, dirty, staleSave}` for a same-workspace Explorer transaction. The record retains no live model. `replace` accepts an explicit `documentStates` Map and validates every entry against the staged record/source before the ownership commit. A clean state must save its exact source; a dirty state may retain a matching immutable saved baseline or `null` for a new unsaved file. This lets rename and file-operation undo preserve unsaved changes without flattening their source or mutating document-owner fields from Studio. The separate Explorer scope qualifies this extension; see `a19-explorer-snapshot-operations.md`.

## Focused qualification

`tests/a19-prepared-documents.test.js` covers actual chunked File-to-model-to-document adoption, shared model/map identity, hidden source roots, read-only and dirty append behavior, mismatched/stale records, staged rollback, cancellation and postcommit cleanup errors. `tests/a19-document-snapshot-save.test.js` covers lazy captured saves, streaming-compatible payloads, async save races, failed I/O, replacement and foreign snapshot rejection. `tests/a19-removed-project-profiles.test.js` covers deleting a project without changing the workspace epoch and exporting consistent startup/profile metadata.

The completed ingress/save/recovery dependency batch passed **67/67 tests with no skips** in 2.3094 s through the repository's bounded wrapper; the exact command is recorded in `a19-session-evidence.md`. Browser ingress, actual writable file handles and Save As integration are qualified by the integration/editor agents. No speedup or native provider pass is claimed here.
