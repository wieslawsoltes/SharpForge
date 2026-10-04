# Nested local TypeRef chains

This partial #2400 batch resolves nested non-generic references anchored in
an explicit current-Module scope. Exact name/namespace byte keys are indexed
under the canonical enclosing TypeDef token, so same-spelled children under
different parents cannot bind accidentally. Existing nested TypeDef handles
are reused; no second type identity registry is created.

Scope traversal is iterative, memoized and cancellable. Existing limits bound
TypeDef/TypeRef counts and name bytes; nested scope edges additionally use
`min(maxDepth, 64)`. The existing 64-level NestedClass validator is extracted
and reused, with its member diagnostics preserved. Combined type/member
contexts pass the validated forest internally instead of parsing it again.
Local aliases normalize hierarchy edges before cycle and kind validation.

Nil scopes remain separate: ECMA II.22.38 describes ExportedType resolution,
and the pinned CoreCLR loader performs assembly-wide lookup for absent scopes.
The earlier retained capture's nil-scoped success does not prove that every
nil reference belongs to the current module. Generic definitions and scopes
remain unknown until generic environments/substitution are supported.

References: [ECMA-335, sixth edition](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
[CoreCLR 10.0.5 type loader](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/clsload.cpp#L1930).

The fixture covers forward and multi-level reference scopes, sibling/top-level
name collisions, private nesting, exact Unicode/BOM identity, nested hierarchy
edges, wrong enclosing identities, unresolved external/nil/generic parents,
duplicate declarations, malformed ownership, cycles, depth limits, cancellation
and snapshot mutation. Native capture reuses the independent CoreCLR
`Module.ResolveType` observer from the preceding local-reference batch and
retains all raw observations before adapter comparison. MemberRef owners now
pass local TypeRef aliases through the same canonical type resolution and
declaration lookup. A second independent `Module.ResolveMember` capture reuses
the qualified inherited-member fixture, with top-level and nested TypeRef
owners; inherited methods and declaration-only fields keep their existing
semantics. External, generic and ambiguous owners remain unknown.

Scheduled serial commands:

```sh
node scripts/limited.js node tests/fixtures/a03-nested-type-references/capture.mjs /tmp/nested-type-references-native.json
node scripts/limited.js node tests/fixtures/a03-nested-type-references/member-capture.mjs /tmp/nested-type-references-members.json
node scripts/limited.js node --test tests/a03-07-nested-type-references.test.js
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-nested-type-references.mjs /tmp/nested-type-references-performance.json
```

Local qualification, native captures and performance measurements are pending
the root-owned serial slot. Browser/source/direct-CIL/Rust/Wasm execution is
outside this metadata-only batch; those targets are not reported as passed.
Project6 and #2400 remain open.
