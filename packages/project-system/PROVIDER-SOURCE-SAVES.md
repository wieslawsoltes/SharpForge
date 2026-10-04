# Provider saves with immutable source records

`ProviderDiskWorkspace.save(changes, options)` also accepts a change with an
immutable `source`. It captures that exact source and preserves the record's
encoding, BOM and path metadata. The existing shared encoded-record helper
performs bounded conversion only at the physical write boundary; discovery and
admission do not access compatibility text getters.

C# source eligibility is checked before a write: malformed surrogate pairs, NUL
and an unmarked leading BOM retain the strict source-reader diagnostics. Binary
and ordinary text saves retain their existing encoding and byte limits.

The existing provider save locks, permission decisions, preflight hashes,
permission-time reread, partial-commit receipt and physical baselines remain
authoritative. Optional synchronous `options.check()` lets a document/session
owner reject a stale capture around asynchronous provider operations. Provider
I/O does not mark a live DocumentService model clean; that remains its owner's
responsibility after checking record and snapshot identity.

## Evidence and composition

The two original `tests/a24-provider-source-save.test.js` cases passed in the
completed canonical integration run: all three supported source encodings
preserve captured roots/BOM/hash, and invalid source snapshots reject before
stream effects. They use the real incoming Documents and P18 session host, so
the unchanged fixture belongs to the following session composition layer.
Existing provider save tests already belong to this branch's actual disk-write
parent. No test or reference tool was rerun for this projection.

All four implementation blobs are exact corrected source
`7b087e0f0e3105c71ec86e39554358766b45d3bf`. The actual dependency join
contains disk-writes #3652 and corrected prepared-records #4299; it retains
both histories, the default incoming disk API and every public export.
