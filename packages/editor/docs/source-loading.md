# Prepared source loading

`readEditorSource(blob, options)` decodes a File or Blob through bounded
`slice().arrayBuffer()` calls into a private persistent buffer. It returns only
after decoding and validation finish. It never calls the input's whole-file
`text()` or `arrayBuffer()` method. `LargeFilePolicy.load` uses this same decoder
and replaces its editor model only after the prepared model is complete.

Options include `uri`, `version`, `signal`, `chunkSize`, `maxFileBytes`,
`maxCharacters`, `onProgress` and an optional `encoding`. Byte and decoded UTF-16
character limits default to 256 MiB. Chunk size defaults to 1 MiB and must be a
positive integer of at most 8 MiB. Studio's `readStudioSource` contribution uses
256 KiB chunks and its explicit workspace byte limits. The loader yields between
chunks and checks cancellation before and after each asynchronous read.

A UTF-8, UTF-16LE or UTF-16BE BOM selects the encoding. BOM-less source defaults
to UTF-8; callers may explicitly choose one of these encodings. A conflicting
BOM, malformed encoding, NUL text, short read, exceeded limit or aborted signal
rejects the complete load. `TextDecoder` streaming state retains partial byte
sequences between chunks. Progress reports completed byte counts, excluding the
small BOM-detection read.

The result contains `path`, `encoding`, `bom`, `byteLength`, lazy `text` and
`version` properties. Nonenumerable `model`, `source`, `originalSource` and
`length` properties expose the prepared editor model and its immutable initial
snapshot without serializing editor internals. `source === model.snapshot()` on
return. Edits to the model leave that captured original snapshot intact. The
model starts clean, at the requested version, with an empty undo history.

`rebaseEditorSource(record, newUri)` creates a separate clean model over the same
persistent text tree with a new URI. It requires the record's captured snapshot
to match its model's current snapshot; stale preparations are rejected. It does
not read the whole text, mutate the original model, or dispose the original.
The project system accepts this function through explicit `rebaseSource`
contributions when stripping a manifest root or prefixing imported paths.

The caller owns the model until a whole workspace adoption succeeds. Failed or
cancelled loads do not replace any live editor. A multi-file reader disposes the
models that it created if its own batch fails; a failed DocumentService adoption
leaves the caller's prepared models intact. User exports may explicitly read
`text`; project discovery, view creation and disk baselines retain snapshots.

When a current prepared root has changed from `originalSource`, URI rebasing
also rebases the original root separately. The old `byteLength` is never
labelled as the encoded size of the edited source. An absent original byte
baseline remains unknown; unchanged rebases keep their zero-read identity proof.

The persistent tree avoids repeated whole-document concatenation: decoding and
leaf indexing are linear in input length, and each append updates a logarithmic
tree path. This is an implementation bound, not a measured main-thread latency
claim. Actual browser event-loop and 200 MB interaction qualification remains
separate from the deterministic Node File/Blob tests.

## Qualification

The complete source batch at `acdf945d` passed all 28 new ingress fixtures:
nine decoder/model-adoption cases, twelve prepared workspace/streaming-save
cases and seven path-rebasing/handle-ownership cases. The complete affected I/O
regression scope reached 196 distinct passes after repairing one missing local
workspace package link and rerunning only the checks that it blocked. The
commands and exact initial failure/retry counts are retained in
`../VIEW-COVERAGE.md`. Node 24.19.0 File/Blob/TextDecoder behavior was exercised;
writable filesystem handles were explicit test doubles. No actual browser
latency, native permission-dialog or physical disk-throughput result is implied.
