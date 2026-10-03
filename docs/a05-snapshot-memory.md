# Memory state in portable snapshots

Memory snapshots retain immutable location descriptors and copy frame-owned byte
regions. Portable encoding replaces VM owners, heap owners and MethodTables with
identities resolved by the destination VM. Every referenced frame, region, pin
lease and array must exist in the captured graph; validation does not consult the
running heap for those locations.

Preflight checks the source evaluation stack, CIL frame storage, parked live
contexts, nested value payloads, heap/static escape rules and full Span bounds.
Readonly state cannot be relaxed by a transferred Span. Distinct stack allocations
cannot share a backing buffer, and each allocation/lease identity is bounded by
the captured sequence counter. Destination stack-memory limits apply on restore.

The focused fixtures cover source, reloaded source and CIL stackalloc/readonly
Span execution, JSON and structured-clone transfers, independent pinned-array IL,
nested struct copies, nullable boxing, collection after source-VM disposal,
expired pointers, malformed ranges, revoked handles and atomic rejection.
Source-language unsafe/fixed and general struct syntax are not prerequisites for
the independent CIL cases.

Validation is deferred until the complete E01 scope is assembled:

```sh
node --test tests/a05-snapshot-memory.test.js tests/a05-snapshot-memory-invalid.test.js
```

Record the exact integrated commit and supported Node/browser versions when these
fixtures run. No execution result is claimed here. Varargs/typed-reference packet
validation is owned by `varargs-snapshot-validation.js` and must remain registered
with the common snapshot preflight beside the memory validator.
