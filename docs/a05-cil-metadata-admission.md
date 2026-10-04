# CIL metadata admission and diagnostic consistency

This SF-A05-T02 follow-up preserves the current runtime's exact metadata checks
while incorporating the relevant retained P18 fixes. It does not replace the
modern execution profile or MethodTable implementation.

## Type handles and closed fields

`ldtoken` may name an open generic TypeDef or TypeRef: obtaining that metadata
handle does not allocate storage for the open type. A TypeSpec still validates
constructed arity and declaring type/method variable bounds. Open generic locals
and allocation operands retain their executable-storage checks. The internal
`token-profile.js` seam and focused admission fixtures are retained from
`a5431950f395377e99eb0a0b22910cbf5dbe6ee0`; the current opcode, memory and indirect-call
profiles are preserved.

A closed field MemberRef already carries its substituted signature and owner.
Resolving its receiver validates assignability and finds the inherited field slot
without replacing that signature with canonical MethodTable display names. An
open FieldDef continues to obtain its storage type from the receiver's declaring
instantiation. Cache entries remain immutable and scoped to VM, code generation,
receiver and closed context. Wrong-owner, foreign and collected receivers still
fail on every access. This narrow rule is retained from
`0cc07293309772f32dac8d5dd09bdb5c6a798e0d`.

| Capability | Execution contract | Regression coverage |
| --- | --- | --- |
| Open generic metadata handle | TypeDef/TypeRef admitted; no open storage allocation | `a05-type-handle-admission`, `a05-tokens` |
| Closed MemberRef fields | Exact substituted metadata with receiver/owner guards | `a05-closed-field-owner`, `a05-token-cache` |
| Unknown host-edited opcode | `NotSupportedException` in raw and predecoded execution | `a05-cil-admission-diagnostics`, `a05-seams-cil-handlers` |
| Invalid rethrow | Admission rejects `IL_EH_FLOW` / `CILCF0001`; runtime guards still fault after a host edit | `a05-exception-events` |
| EH boundary inside a prefix group | Admission rejects `IL_EH_FLOW` / `CILR0017` | `a05-constrained-interface-calls` |

Run `node examples/runtime/type-handle-identity.mjs` to compare primitive and open
generic handles through actual `ldtoken` instructions. Direct CIL
owns these metadata paths; source execution does not consume CLI metadata tokens.

## Corrected historical fixtures

The type-system seam fixtures previously supplied a partial inspector object
without the metadata and method maps required by current dispatch construction.
They now build real CLI metadata through the existing generic fixture and use a
real `AssemblyInspector`. Their no-linear-scan, ancestry, layout-offset and
foreign-field assertions are unchanged. The helper is retained from the same P18
head as the closed-field correction.

The old invalid-rethrow event case tried to instantiate a method the current
lexical verifier correctly rejects. It now checks that rejection explicitly and
uses host replacement of an admitted body to exercise the runtime event guard.
The constrained-prefix case also used an invalid zero catch token, masking the
intended boundary defect. It now supplies a valid catch type and checks the stable
instruction-group diagnostic produced before prefix semantic admission. No
verifier rejection was removed or weakened.

## Validation

Focused validation is pending the coordinated serial slot. Proposed command:

```sh
node scripts/limited.js node --test tests/a05-type-handle-admission.test.js tests/a05-tokens.test.js tests/a05-token-cache.test.js tests/a05-closed-field-owner.test.js tests/a05-seams-cil-types.test.js tests/a05-cil-admission-diagnostics.test.js tests/a05-seams-cil-handlers.test.js tests/a05-exception-events.test.js tests/a05-constrained-interface-calls.test.js
```

This batch does not claim CLR, browser or Rust qualification, nor a measured
performance change. Type-handle admission and receiver-field cache misses are
cold metadata work; warm field access keeps its existing cache hit.
