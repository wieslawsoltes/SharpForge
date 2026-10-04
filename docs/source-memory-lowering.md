# Source memory lowering

The source compiler retains managed storage identity for `ref`, `out`, and `in`
parameters, ref locals and returns, object and static fields, vector and rectangular
array elements, and Span elements. Passing a reference no longer promotes an ordinary
local to a synthesized closure cell. Captured variables still use the existing closure
representation; their field addresses refer to that same captured storage.

Rectangular arrays carry their actual element type and rank. Creation, indexing,
element addresses, dynamic dimension queries, and row-major enumeration use the
runtime's checked array operations. System.Array reflection calls retain lower bounds
and array identity. `Array.Resize<T>` has a generic method signature with a real `T[]&`
argument, including a MethodSpec when emitted to CIL.

Span lowering covers stack allocation, default values, indexing and managed addresses,
Slice, Length, IsEmpty, readonly conversion, enumeration, ToArray, and array/string
conversions. Stack allocations remain attached to their allocating frame. The binder's
ref safety checks run before lowering; the runtime validates owners and frame lifetime
when the emitted references are used.

The source-image CIL adapter emits ordinary CLI operations and framework calls. Its
loader recognizes the corresponding CIL spans, checks their signatures, reconstructs
the source image, and retains the complete canonical re-emission comparison. Constructed
array and Span inline types use TypeSpec rows. The source and CIL paths share the
underlying runtime storage operations.

`tests/a05-source-memory-lowering.test.js` exercises direct source execution with fusion
enabled and disabled, CIL reload back into the source VM, and direct CIL execution.
The tests include aliasing, rectangular bounds, lower-bound reflection, overlapping
copy/resize, Span slices, and compiler rejection of escaping or readonly references.
The corresponding source address/memory opcode handlers are integrated with the
shared runtime storage operations; execution evidence remains revision-specific.

The unsafe source path emits owned pointers for raw stack allocation and local
address conversion. Pointer arithmetic scales offsets by the pointee size. A fixed
primitive-array scope has a synthetic pinned local and explicit finally cleanup;
null and empty arrays produce null pointers without acquiring a lease. Leaving the
scope revokes every derived pointer. Fixed string and object-field storage remain
outside the primitive-array pin profile and are rejected during source compilation.
The profile also rejects converting an owned memory capability to an exposed integer.
`tests/a05-source-unsafe-memory.test.js` covers pin rooting, release on return and
exception, null/empty arrays, pointer arithmetic, local addresses, and expired pins
through the source, source CIL reload, and direct CIL routes.

## Runnable memory contracts

Run these examples serially from the repository root:

```sh
node scripts/limited.js node examples/runtime/managed-references.mjs
node scripts/limited.js node examples/runtime/rectangular-memory.mjs
```

Each compiles one source program, checks its exact trace in the source VM, the
canonical source image reloaded from emitted CIL, and the direct CIL VM, then stops
each VM. The first demonstrates `Swap`, `out`, a ref-returning indexer, same-location
aliasing, collection while a ref local is live, and `in` struct defensive copies.
The second demonstrates rectangular/lower-bound arrays, stack-backed Span slicing,
readonly views, a primitive-array fixed scope, and managed bounds faults.

| Capability | Source and reloaded source | Direct CIL | Regression/example |
| --- | --- | --- | --- |
| `ref`/`out`, ref locals and ref-returning indexers | Owned storage aliases | Managed addresses with exact signature types | `a05-byref-call-scenarios`; `managed-references.mjs` |
| `in` user struct receiver | Readonly address and defensive call copy | Readonly managed receiver | Same scenario; `a05-source-value-structs` |
| Frame expiration and reference owner roots | Lifetime validation and root capture | Same ownership/lifetime contract | `a05-managed-address`, `a05-frame-memory-retirement`, `byref-gc-stress` |
| Rectangular rank/bounds and nonzero lower bounds | Native array shapes and checked indexing | Exact array pseudo-method/reflection contracts | `rectangular-memory.mjs`; `a05-typed-rectangular-arrays` |
| Stack Span, slices and readonly views | Scoped frame storage | `localloc` plus validated memory intrinsics | Same example; `a05-stack-regions-spans-pins` |
| Fixed primitive arrays | Lexical pin lease and finally release | Pinned-local lease and frame cleanup | Same example; `a05-source-unsafe-memory` |
| Fixed strings/object fields; pointer-to-integer exposure | Explicitly outside this profile | No broader capability claim | Profile exclusions above |

The examples and `tests/a05-byref-call-scenarios.test.js` /
`tests/a05-runtime-memory-examples.test.js` passed through source, reloaded source
and direct CIL at `d9453a979`. That focused cohort had 40 passes, zero failures and
seven skipped existing compiler reference-binding cases requiring an unavailable
.NET reference pack. The source ref-indexer case ran and passed. The
[retained manifest and log](a05-evidence/integration-validation-20261004/README.md)
preserve the full revision, scope and digests.

The negative indexer cases reject returning a local byref and passing a readonly
ref result as `out`; existing memory tests cover runtime expiry after frame
retirement and pin revocation. The later
[default stack-byte policy](default-managed-stack-budget.md) passed its focused
112-case cohort at `c47260dfe`, including 10,000-call execution on all three routes.
These results describe distinct, overlapping cohorts and must not be added into
a full-suite count.

The broader `3b482d83b` A05/preemption/security run subsequently recorded 3,162 passes,
25 failures and zero skips across 3,187 tests. It does not establish a completed
project. The examples use authored expected traces; fresh native SDK and browser
results remain separate qualification.
