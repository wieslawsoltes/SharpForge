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

At product commit `ec8d13b77`, the scheduled serial run passed 74/74 tests
across the two new and nine existing type/member/access/guard files. The
isolated baseline at `d51b3ad69` failed the positive alias test because its
result was unknown (`baseline-red.txt`). Both worktrees had independent npm
installs and their own CIL links; candidate source stayed unchanged.

Pinned SDK 10.0.201 / CoreCLR 10.0.5 captured 20 ResolveType observations.
All nine supported aliases agreed, including nonpublic, Polish Unicode and
leading-BOM names. The runtime also resolved the nil-scoped reference; this
adapter deliberately leaves it unknown along with external, nested and
generic references. `native.json` retains every observation, including
failed loads and missing names, plus toolchain and source hashes.

One chronological benchmark run per variant retained all 72 raw samples
in `performance.json`, with exact commits, source/input hashes and commands.
Each sample contains 1,000 operations; the first three of twelve are warmups.
On shared Apple M3 Pro / Darwin 25.6.0 / Node 24.21.0:

| Workload | Before median / p95 (ms) | After median / p95 (ms) |
| --- | --- | --- |
| Existing construction | 3.361459 / 4.262458 | 3.929166 / 4.304459 |
| Existing inherited-interface query | 0.363542 / 0.391125 | 0.338542 / 0.373042 |
| Local-reference construction + resolution | 3.518791 / 3.887625 (unknown) | 10.023667 / 10.185459 (known) |

Existing construction median rose 16.8887% (+0.567707 ms per 1,000), with
p95 +0.9854% (+0.042001 ms). The Project6 integrator explicitly accepted this
over-budget median for bounded scope preflight and canonical alias support;
name indexing remains lazy and existing TypeDef identities are reused.
The new local workload changes from unknown to known and includes name
indexing/alias normalization. Its full cost is reported as added capability,
not as an existing supported-operation regression.
These measurements do not establish a speedup, explain variance, or measure
allocation volume/peak memory; all heap deltas are retained as observations.

Syntax (3,565 modules), static imports (3,561), manifest coverage (30 areas,
962 Node files, no unassigned/duplicate files), and diff checks passed.
Structure reported 271 existing findings, none in changed files. Ordinary
automatic PR core passed; no broad engine qualification was run. This batch
does not execute source/direct-CIL/Rust/Wasm methods, load external assemblies,
or add generic substitution, TypeSpec normalization or nested resolution.
Project6 and #2400 remain open.
