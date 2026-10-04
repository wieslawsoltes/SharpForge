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

The [closed project reference contract](PROJECT-REFERENCES.md) documents explicit PE
identity/hash descriptors, shared admission bounds and appended external opcodes.

## Builtin metadata

`builtinOwners`, `builtinMemberShape(builtin)` and `builtinParameterType(builtin, type)` expose the same
core intrinsic owner and parameter rules used by the compiler. Pass descriptors from `Builtins` or
`BuiltinMap`; the functions project metadata without modifying descriptors, stable numeric IDs,
receiver-inclusive runtime parameter lists or execution behavior. `builtinMemberShape` returns
`{name, instance, property}`. Core builtin entries whose names begin with `$` are internal and should
not be shown as source API members. Framework contracts continue to use their registered owner and
signature metadata.
