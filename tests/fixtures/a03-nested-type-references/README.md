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

Qualification used isolated baseline `b0dff7f77`, independent installs and own
CIL workspace links, explicit Node 24.21.0, one limiter reservation, test
concurrency 1 and a 1 GiB Node heap. Product source remains `ed8e37937`.
The baseline regression fails because nested references are unknown; all 85
focused/affected tests pass on the candidate. Pinned SDK 10.0.201/CoreCLR 10.0.5
captured 25 type references (all 12 supported aliases agree) and 8 member
references (5 canonical agreements and 3 native errors/adapter unknowns).
Syntax/import checks passed 3596/3592 modules with zero errors; manifests have
no unassigned files. Structure reports 271 existing findings, none in changed
files. [Raw evidence](qualification/summary.json) retains hashes and logs.

Two first attempts remain recorded. The initial member fixture appended an
enclosing TypeDef after its nested children, so CoreCLR rejected the image
before alias semantics could be observed. The corrected fixture uses the
preceding Base definition as the enclosing root, preserving member tokens and
signatures. The initial focused run passed 84/85: the inspector's existing
display-name limit rejected nesting 65 before the adapter diagnostic. The test
now asserts that rejection and separately extends parsed 64-level rows to
exercise both adapter TypeRef-chain and lexical-depth limits. Product source
did not change. Before/after hashes and the original failures are retained;
already completed captures and benchmarks were not repeated.

On shared Apple M3 Pro/macOS Darwin 25.6.0, timings below are milliseconds per
1000 operations, with median/p95 computed after three warmups from each fixed
12-sample run. All 96 chronological samples remain in `qualification/`.

| Existing workload | Baseline median/p95 | Candidate median/p95 |
| --- | --- | --- |
| Adapter construction | 3.918625 / 4.822125 | 3.834042 / 4.591208 |
| Inherited-interface query | 0.368250 / 0.377041 | 0.346750 / 0.377208 |
| Local-alias construction and resolution | 10.813750 / 12.569750 | 12.522958 / 15.501583 |

The existing local-alias workload increased by 1.709208 ms median (+15.805877%)
and 2.931833 ms p95 (+23.324513%) per 1000 contexts. Root review explicitly
accepted these approximately 1.709/2.932 microsecond per-context increases for
bounded nested alias/member-owner support, with lazy enclosing-name indexing,
shared lexical facts and existing canonical handles. No second registry exists.
The new nested workload changes unknown to known; its full candidate cost is
15.865000/22.997292 ms per 1000, an added capability rather than an existing
supported-operation speed comparison. No causal attribution, noise explanation,
general speedup, allocation-volume or peak-memory claim is made. Heap deltas
are retained observations only, and batch p95 is not individual latency p95.

Browser/source/direct-CIL/Rust/Wasm execution is outside this metadata-only
batch; those targets are not reported as passed. Project6 and #2400 remain open.
