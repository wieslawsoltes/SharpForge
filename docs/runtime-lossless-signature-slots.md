# Lossless metadata signature slots

The public CIL helpers `readExecutionSignatureAst` and `signatureSlotType` expose
the existing signature AST at executable metadata slots. This is a prerequisite
for #1359 typed instance-pointer storage, not admission of that storage.
The later [typed-local consumer](runtime-typed-instance-pointer-locals.md) uses
these APIs for its separate, narrowly admitted runtime behavior.

`readExecutionSignatureAst(metadata, token, options = {})` reads Field (4),
MethodDef (6), MemberRef (10), StandAloneSig (17) or MethodSpec (43) signatures
from the exact table's blob column. It rejects zero, fractional, out-of-range,
missing and unsupported tokens, and signatures whose kind does not belong in
that table. The AST retains `hasThis`, `explicitThis`, calling convention,
generic arity, sentinel position, modifiers and nested function-pointer types.
Every returned node and array is frozen.

The helper passes options directly to `decodeSignature`, preserving its depth,
node and cancellation limits and its malformed-blob errors. Decoding and freezing
take linear work in the bounded signature size. The helper has no cache; callers
retain their own immutable results with the metadata owner. Re-reading metadata
produces a new AST, so there is no cross-inspector or stale global identity cache.
Raw type tokens still belong to their originating metadata; this API does not
establish equivalence across assemblies or substitute generic parameters.

`signatureSlotType(ast, kind, index)` returns the original raw type node:

| Kind | Required signature | Index |
| --- | --- | --- |
| `local` | `locals` | Zero-based local slot |
| `parameter` | `method` | Zero-based declared parameter, excluding implicit `this` |
| `return` | `method` | Omitted |
| `field` | `field` | Omitted |

The selector expects a decoded AST. Invalid slot kinds, incompatible signature
kinds, missing or invalid indexes, and indexes on non-indexed slots throw
`CilError`. Pinning and custom modifiers remain attached to the returned node.

The existing function-pointer execution gate uses the reader before its
historical display projection. Its per-verification cache remains unchanged,
and unsupported pointer headers are still rejected. `AssemblyInspector`,
signature formatting, compiler type strings, runtime carriers and snapshot
schemas are unchanged. In particular, equal display text such as
`method int *(int)` is still insufficient evidence of function-pointer identity.
Runtime consumers must use the raw header and typed slots before any future
admission change. No new function-pointer calling convention is enabled here.

The authored metadata fixtures cover all five table layouts, raw flag variants
with identical display strings, nested pointers, modifiers/pinning, immutable
slot identity, independent metadata readers, invalid slots and tokens, parser
limits/cancellation, and unchanged static-pointer admission. They have not been
run. No tests, checks, builds, native processes or benchmarks were executed.
The root agent owns the serial validation queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-lossless-signature-slots.test.js tests/a05-managed-calli.test.js tests/a05-calli-stack-byte-budget.test.js tests/a03-02-signatures.test.js tests/a03-02-signature-compatibility.test.js
```
