# Explicit Module-scoped TypeRef resolution

This partial #2400 batch resolves unique same-module top-level definitions
through explicit Module-scoped TypeRef rows. Canonical identities and the
hierarchy snapshot are shared with existing TypeDef resolution; local aliases
are normalized before cycle and edge-kind validation.

The synthetic Node tests cover exact namespace/name and UTF-8 byte identity,
duplicate names, nonpublic top-level definitions, missing and unsupported
scopes, generic definitions, malformed indices, fixed/lowerable byte and row
limits, cancellation, heap mutation and alias-induced cycles/kind errors.
Names are indexed once during construction, in O(types + references + name
bytes); indexed unique bytes and reference count have explicit hard limits.

`capture.mjs` emits a fixture using the existing MetadataBuilder/PE writer,
compiles the independent `Program.cs` observer with the pinned Roslyn
toolchain, then calls CoreCLR `Module.ResolveType` for every TypeRef.
It retains compilation and execution results before comparing anything with
the adapter. The capture includes tool versions/hashes, fixture bytes/hash,
source hashes and native observations. Native observations also cover
supported CLR cases deliberately left unknown by this batch: external,
nested and generic references. A native success in those rows does not imply
that the adapter supports them.

Scheduled serial validation commands:

```sh
node scripts/limited.js node tests/fixtures/a03-local-type-references/capture.mjs /tmp/local-type-references-native.json
node scripts/limited.js node --test tests/a03-07-local-type-references.test.js tests/a03-07-local-type-references-native.test.js
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-local-type-references.mjs /tmp/local-type-references-performance.json
```

Validation and native capture are pending the shared serial slot. This batch
does not execute source/direct-CIL/Rust/Wasm methods, load external assemblies,
or add generic substitution, TypeSpec normalization or nested resolution.
Project6 and #2400 remain open.
