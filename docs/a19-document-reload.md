# Atomic external document reload

`DocumentService.reload(uri, text, options)` accepts an explicitly approved external source into one existing document.
The disk observer owns reading, cancellation, dirty-document confirmation and disk conflict verification. Reload is the
synchronous document/metadata commit boundary; it performs no I/O and does not change ordinary save timing.

```js
documents.reload(uri, observedText, {
  expectedRecord,
  expectedVersion,
  encoding,
  bom,
  byteLength,
  commitMetadata(captured) {
    // Revalidate the disk target/client and publish its already prepared baseline synchronously.
    acceptDiskBaseline();
  }
});
```

Both `expectedRecord` and `expectedVersion` are required and must identify the current document exactly. A replacement
record at the same URI/version is stale. Disposed and read-only documents reject before mutation. Encoding and BOM are
validated with the workspace encoder, and an optional observed `byteLength` must match the encoded text. Both the incoming
and existing source must fit `AUTOMATIC_DOCUMENT_CHARACTERS` (8,000,000 UTF-16 code units), shared with automatic file
observation. Larger sources require an explicit workspace reopen through chunked ingress; this API never silently
materializes a larger previous buffer for undo.

For editor-backed documents, reload retains the exact shared model and existing views. It prepares one edit after finding
the unchanged prefix/suffix in bounded ranges, commits without notifications, marks the new root saved and installs the
record/model encoding, BOM and exact byte count. `record.originalSource` becomes the new immutable root and remains
nonenumerable. One undo operation restores the prior content; undo makes the document dirty against the accepted external
baseline, and redo returns to the saved undo state. Identical text accepts metadata without adding an edit or advancing its
text version. The service revision still advances for a successful reload.

`commitMetadata` runs after private document preparation and before any document, buffer or editor notifications. It may
inspect the returned capture, including the intentionally advanced document version. It must revalidate target/client and
record identity as needed, complete synchronously and publish metadata without unrelated source mutations. A rejection
before external metadata commits restores the model checkpoint, selection/undo state, record format, saved baseline and
dirty/stale flags; no reload events are emitted. A callback returning a promise is invalid. If metadata has already
committed before a callback reports a secondary failure, its error must carry `committed: true`.

After acceptance, changed/saved/dirty notifications observe coherent source and metadata. Notification or view refresh
failures never roll back accepted disk content: they report `DOCUMENT_COMMITTED` with `committed: true` and aggregate the
postcommit failures. Remaining document notifications and independent legacy view refreshes are still attempted. The
successful result is `{ committed: true, record, source, version, encoding, bom, byteLength }`; `source` is undefined for a
legacy document without an editor model. A newer edit made by a notification callback remains dirty against the accepted
external source; later publication effects verify the captured source/version and skip obsolete reload notifications.

The algorithm compares at most both source lengths and retains only one changed range in undo history. Comparison reads
use 64 KiB ranges; encoding validation and the changed undo payload are bounded by the shared reload limit. This is an
explicit synchronous commit operation, not the ingress path for large files.

## Qualification

`tests/a19-document-reload.test.js` covers coherent notifications, model identity, undo/redo, precommit rejection and
checkpoint restoration, committed callback/document/model/view failures, stale/read-only/disposed guards, encoding and
byte-count rejection, newer edits made by callbacks, same-text metadata changes and the exact shared size boundary.

The completed source ran through the repository limiter:

```sh
node scripts/limited.js node --test tests/a19-document-reload.test.js tests/a19-document-models.test.js tests/a19-document-snapshot-save.test.js
```

That run passed 26 of 28 cases. Two new assertions incorrectly expected selections to contain only `anchor` and `active`,
omitting the editor's normalized metadata. The assertions now compare the complete captured selection state. No production
source changed for this correction. The affected file then passed all 14 cases:

```sh
node scripts/limited.js node --test tests/a19-document-reload.test.js
```

The result is 28 distinct passing cases across the completed scope: 14 reload, 8 document-model and 6 captured-save cases.
The original three-file run was not repeated; disk/native observer composition is qualified separately with its real adapters.
