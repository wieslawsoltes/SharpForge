# @sharpforge/bytecode

Versioned typed-array instructions, metadata, verifier, serializer and disassembler.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/bytecode';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

`createBuiltinRegistry(base = Builtins)` appends validated builtin contributions
without changing existing slot identities. Sparse array reservations remain
holes, including in the frozen `entries` snapshots; new IDs start at the base
array's length. Non-array iterable bases remain supported. Rejected or cancelled
contributions leave the registry unchanged.

The default `Builtins` table and its registry snapshots copy only occupied numeric
slots, so copy and lookup construction work scales with the number of entries,
not the largest reserved ID. Snapshots remain frozen arrays with the same length
and slot identities. Custom array bases retain their existing `slice` behavior,
including nonenumerable numeric slots, explicit `undefined`, accessors, inherited
indices, subclass species and proxies; non-array bases retain iterable behavior.
The JavaScript engine determines array storage costs; no fixed memory reduction
is part of this API contract.

## Builtin metadata

`builtinOwners`, `builtinMemberShape(builtin)` and `builtinParameterType(builtin, type)` expose the same
core intrinsic owner and parameter rules used by the compiler. Pass descriptors from `Builtins` or
`BuiltinMap`; the functions project metadata without modifying descriptors, stable numeric IDs,
receiver-inclusive runtime parameter lists or execution behavior. `builtinMemberShape` returns
`{name, instance, property}`. Core builtin entries whose names begin with `$` are internal and should
not be shown as source API members. Framework contracts continue to use their registered owner and
signature metadata.

## Source value conversions

`sourceValueInstruction(image, opcode, typeIndex, declaredTypes?)` describes the
stack effect and result type of the source `BOX` and `UNBOXANY` instructions. Both
consume one operand and produce one result. `BOX` produces `object`;
`UNBOXANY` produces the exact type named by `image.constants[typeIndex]`.

The target must be an admitted numeric scalar, `bool`, or a declared source type
with `valueType: true`. A reference type, an unresolved type parameter, or an
invalid constant index throws `TypeError`. Other opcodes return `null`. The
optional map contains the same declarations as `image.types`, keyed by name; it
lets a verifier or CIL analysis reuse its existing type index. The helper does
not mutate instructions, constants, or declarations. Execution checks the actual
boxed type and performs a value copy when unboxing a struct.

### Closed source nullable values

`sourceNullableElement(type)` returns the underlying source type of a closed
nullable signature, or `null`. `sourceNullableInstruction(image, opcode,
typeIndex, operation, declaredTypes?)` returns its verified stack effect and
result type, returns `null` for another opcode, and throws `TypeError` for an
invalid closed owner or operation. `NULLABLE` is opcode 57; operations 0–6 are
default, construction, HasValue, Value, parameterless GetValueOrDefault,
GetValueOrDefault with a fallback, and ToString. Source boxing/unboxing accepts
these closed nullable value types and retains the runtime's exact underlying
box identity contract.

Closed source generic declarations may carry an additive logical `sourceIdentity`
descriptor. `copySourceTypeIdentity(value)` owns/freezes one bounded descriptor;
`sourceTypeIdentities(types)` validates declarations and returns their physical
owner-to-identity Map. `verifyImage` rejects malformed and colliding identities.
The schema, budgets and runtime projection boundary are documented in
[Source generic type identities](../../docs/a05-source-generic-type-identities.md).
