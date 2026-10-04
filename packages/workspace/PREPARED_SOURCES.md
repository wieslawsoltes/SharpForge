# Prepared source transactions and recovery

Workspace records may contribute an immutable source snapshot through a hidden
`source` property. The snapshot has a URI, version, UTF-16 length and `getText`
range reader. Relocation uses its `withMetadata` method; text replacement uses
`withChange`. A transaction never owns or serializes a mutable editor `model`.

`workspaceRecordSource(record)` recognizes this public contract without reading
the compatibility `text` getter. `cloneWorkspaceRecordSnapshot(record, path)`
copies byte buffers, retains immutable roots, removes models and relocates the
root when a file moves. `cloneWorkspaceState` also clones the `documentStates`
Map, retaining immutable current and saved-baseline roots. Hosts derive dirty
and baseline state at their adoption boundary and place that state in the
receipt's `after` snapshot before persistence or undo admission.

`hashWorkspaceRecord(record, {signal})` hashes exact encoded bytes. Prepared
sources use a SHA-256 stream, with at most 64 KiB of bytes per hashing turn and a
cooperative yield between turns. UTF-8 surrogate pairs are kept together across
source ranges, and a BOM is emitted only at the beginning. UTF-16 little-endian
and big-endian encodings preserve their actual snapshot delimiters. Original
bytes are reused only while `originalSource === source`; edited sources are
encoded again. The SHA-256 implementation follows FIPS 180-4 section 6.2, and
the focused fixture compares public record hashes with Node's reference SHA-256
for padding and chunk boundaries. This is an interoperability check, not a
cryptographic-module certification.

`workspaceRecordBytes(record, {maxBytes})` is the explicit, bounded physical-byte
materialization boundary. It supports the same snapshot contract and encoding
rules. Hashing is linear in encoded byte count and uses constant digest working
space. Physical byte output allocates proportionally to the admitted output
size. Generic transaction/history limits stay unchanged; Studio explicitly
chooses its larger documented workspace limits.

An exception marked `committed: true` by a host means ownership has already
changed. The journal finalizes the adapter once, records the observer error and
preserves the committed receipt. History advances its undo/redo stack once and
then propagates the error. It does not retry adoption or roll back live models.

## Recovery formats

Plain records retain version-one recovery envelopes. Prepared records or
document-state Maps use envelope version two. A bounded source table stores
UTF-16 chunks and immutable-root references, preserving sharing between each
record, its original encoding baseline and its document state. Decoding creates
model-free piece-table snapshots before ordinary record validation. Both
versions retain checksums, secret filtering, lazy membership, quotas and the
double-buffered checkpoint commit point. Future envelope versions are preserved
for a newer reader.

Write-ahead receipts write the before-state and staged after-state before any
physical mutation. Progress updates only rewrite the bounded receipt manifest.
After host adoption, the after-state is sealed once with the actual dirty and
baseline state. A failed close leaves the preceding durable generation intact.
Receipt directory identities advance independently of journal-local operation
ids, so a restarted journal cannot overwrite the preceding durable snapshot.

Explorer revision observation captures roots and sends only hashes/revisions.
The conflict coordinator's optional `readLocal(observed, {signal})` contribution
reads local contents only after an explicit choice. It must return the same
observed hash/revision together with bounded content and baseline data; all
existing stale checks still apply. Studio's peer resolution byte limit remains
16 MiB, with the existing 4 Mi-character text-merge limit. Larger peer contents
produce a diagnostic before materialization.

The source composition has focused hash, journal, recovery and persistence
fixtures in `tests/a24-prepared-source-hashes.test.js`,
`tests/a24-prepared-journal.test.js`, `tests/a24-prepared-recovery.test.js` and
`tests/a24-prepared-persistence.test.js`. The actual Explorer/provider bridge is
covered by `tests/a24-explorer-prepared-journal.test.js`. These files are included
in the coordinated final scope; no passing result is claimed before that run.
