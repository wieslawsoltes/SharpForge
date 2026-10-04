# Captured source Save As

`saveStudioSourceAs` in `source-save-as.js` saves one captured text document. The
Studio save coordinator supplies `DocumentService.captureSave(uri)` and owns
whether a successful result may clear the current document's dirty state. This
helper changes no document, model, workspace, or disk-handle registration.

```js
const result = await saveStudioSourceAs(captured, {
  window,
  download, // optional: (name, binaryBlob, mimeType) => void | boolean | Promise
  signal,
  prepare: async ({signal}) => {
    await editor.prepareSave({signal});
    return documents.captureSave(uri); // the host first checks original document/model ownership
  },
  maxBytes: 256 * 1024 * 1024,
  onProgress: ({phase, bytesWritten, maxBytes}) => updateProgress(bytesWritten)
});
```

## Capture and output ownership

The captured record carries `uri`, `version`, `encoding`, `bom`, and a
nonenumerable immutable `source` snapshot. Its enumerable `text` getter remains
unevaluated. A legacy record with an own string `text` data property is also
accepted. A mutable source or a record offering only a lazy text getter is
rejected; the helper cannot turn a live source into a consistent save by reading
its text later. A source snapshot can also be passed directly; metadata absent
from it defaults to UTF-8 without a BOM.

The helper captures the source reference and metadata before the first await.
Changes to the original wrapper or live buffer while the picker is open cannot
change that capture. An optional `prepare({signal})` callback explicitly replaces
it with a new exact capture for the same URI and a nondecreasing version. Snapshot
metadata must agree with the wrapper. Suggested file names use the URI basename,
with invalid cross-platform filename characters replaced. The original URI is
retained in the result even if the user chooses a different output name.

When `window.showSaveFilePicker` exists, it is invoked synchronously during the
caller’s user gesture, before reading any source characters. The caller should
invoke this helper directly from its activated save command; this helper cannot
restore activation that was already lost earlier in that command. After the
picker resolves, the helper awaits `prepare` if supplied, then creates a writable stream and uses the public
`@sharpforge/project-system` `writeWorkspaceSource` API. A fresh picker handle
does not need a separate permission prompt from this helper.

The preparation callback runs once, before acquiring a stream or creating an
export. A dismissed picker never runs normalization. Cancellation, rejection,
stale URI/version or inconsistent source metadata prevents stream acquisition.
The host callback must also guard the original document/model identity; this
helper does not own the editor workspace. Without a picker, the same callback
runs before collecting the explicit download output.

The shared encoder uses 64 Ki UTF-16 windows, retaining a complete surrogate pair
when it crosses a window boundary. It yields between chunks, preserves CRLF and
UTF-8/UTF-16LE/UTF-16BE BOM behavior, and checks encoded byte limits including the
BOM. Unpaired surrogates are rejected with `SFPROJECT_SOURCE_ENCODING_LOSS`
before close/download, rather than accepting data that a later strict source
read cannot restore. The same diagnostic rejects NUL and a leading U+FEFF
without a separate BOM. Valid surrogate pairs and literal U+FEFF following an
explicit BOM remain lossless. Neither native saving nor the
download fallback joins source chunks into a whole text string.

Native writing retains bounded encoding chunks and awaits sink backpressure.
The download path necessarily retains output-sized binary Blob data, bounded by
the same `maxBytes` limit. Its temporary binary storage is not a constant-memory
native writer, and browser Blob construction/download handling can have costs
outside the chunked encoder. The default 256 MiB cap permits a 200 MiB ASCII
source; encoding a larger number of bytes requires an explicit higher cap.

## Results and failures

Every result retains captured `uri`, `version`, `source`, `encoding`, and `bom`.

| Outcome | Additional result fields | Meaning for the caller |
| --- | --- | --- |
| Native close completed | `ok: true`, `handle`, `name`, `byteLength` | The browser stream confirmed the captured output; the caller may mark that captured identity/version saved. |
| Picker or signal cancellation | `ok: false`, `cancelled: true`, `name` | No successful save is reported. Keep the document dirty. |
| Download requested | `ok: false`, `exported: true`, `name`, `byteLength` | The browser or injected provider received a binary export. Its eventual storage cannot be confirmed. Keep the document dirty. |
| Download provider declined | `ok: false`, `exported: false`, `name`, `byteLength` | An explicit `false` response requested no successful-export claim. |

The download provider receives a **Blob**, not a text string. The existing Studio
download provider may wrap this Blob in another Blob without transcoding it. An
injected provider returning `undefined` acknowledges that export was requested;
returning `false` reports rejection. A rejected promise or thrown exception is a
failure. The default browser provider creates a temporary hidden download link,
removes it after activation, and releases its object URL on a later task.

The fallback is available when there is no picker, a returned handle offers no
writable API, or `createWritable` reports `NotSupportedError`. Security,
permission, source, write, close, and size failures reject instead of silently
starting a download. Unavailable hosts report `SFSTUDIO_SAVE_UNAVAILABLE` before
reading source chunks. Invalid handles/streams have explicit
`SFSTUDIO_SAVE_HANDLE`/`SFSTUDIO_SAVE_STREAM` errors.

An acquired native stream is aborted when a write, progress callback, byte cap,
or pre-commit cancellation fails. Cancellation requests abort even during a
pending write; completion still depends on the host settling its I/O. Failed
cleanup is exposed with the original failure in an `AggregateError`. The picker
itself cannot be dismissed through this helper's signal. If cancellation occurs
while stream acquisition is pending, the eventual stream is aborted before its
first read/write.

The commit boundary is the call to `stream.close()`: cancellation is checked
immediately beforehand, and a later signal does not contradict a successful
close. A failed close never reports success. The same boundary applies when a
download provider is invoked, since an initiated download cannot be recalled.
Progress callbacks run after each encoded/write chunk and may return a promise;
their failures follow the same failure/cleanup rules.

## Qualification

`tests/a20-source-save-as.test.js` covers real persistent snapshots behind guarded
chunk readers, a 200 MiB ASCII native output with a non-retaining sink, encoded
byte fidelity, empty BOM output, capture races, picker activation order,
cancellation/close boundaries, native I/O and cleanup failures, output caps,
download-only outcomes, and default link/URL cleanup.

The fixtures supply file handles, streams and DOM boundaries. They do not claim
executed browser permission dialogs, operating-system file durability, browser
download completion, measured memory peaks, or key-to-paint latency. A fulfilled
browser close is the API-level saved-output confirmation; it is not a separate
physical disk synchronization guarantee.

The API behavior follows the
[File System Access picker specification](https://wicg.github.io/file-system-access/#api-showsavefilepicker)
and the
[File System writable stream specification](https://fs.spec.whatwg.org/#api-filesystemwritablefilestream).
The shared encoder is qualified separately by
`tests/a20-prepared-source-workspace.test.js`.

The subsequent complete save-preparation/round-trip follow-up adds
`a20-save-preparation-flow.test.js`, `a20-save-encoding-roundtrip.test.js`,
`a20-disk-save-cancellation.test.js`, `a20-save-normalization.test.js`, and
`text-cooperative-edits.test.js`. It replaces the historical lone-surrogate
success assertion with explicit abort/no-close rejection and retains the valid
pair/BOM byte assertions. Its exact source/results are recorded separately in
`packages/editor/VIEW-COVERAGE.md`; the older measurements below remain tied to
their original source revision.

Observed at source revision `fe2c20f7` on Node.js v24.19.0, Linux x64:

```sh
node scripts/limited.js node --test --test-reporter=spec tests/a20-source-save-as.test.js
```

All **24 tests passed**, with zero failures or skips, in **6.496 seconds**. The
200 MiB fixture took **6.296 seconds**, including construction of its persistent
source, cooperative encoding, byte-by-byte sink verification and stream close.
It emitted exactly **209,715,200 bytes in 3,200 writes**, retained no output
chunks in the sink, and kept the persistent snapshot's lazy text cache
unmaterialized. This fixture duration is not browser save throughput, a memory
peak measurement, or editor typing/rendering latency.

At the completed save follow-up source `fc4ee84a`, the unchanged 24-case Save As
suite passed within a broader 162-case command. Its 200 MiB output fixture took
7.293 seconds. A separate normalization selection defect was corrected at
`54892a70` and only the affected normalization/view/configuration tests were
retried (30/30 passing). The full scope's eventual 163 distinct passing cases
and exact commands are retained in `packages/editor/VIEW-COVERAGE.md`. The
historical/current fixture durations are single observations from different
scope runs on a shared host; they are not a controlled throughput regression
benchmark or actual browser latency qualification.
