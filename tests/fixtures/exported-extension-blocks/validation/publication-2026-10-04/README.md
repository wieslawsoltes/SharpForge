# Extension export publication replay, 2026-10-04

Publication candidate `bdd1bc322574821a9d8dfbb7ce32b21952bb0f2b`
(tree `b908d530d4f8c9079eb8e4f51f6c87d6bb71bb28`) passed **44/44 tests, zero skips**.
It preserves qualified export checkpoint `45c77c9b2410e3afe9949431c73d8a0144f90acf`
and merges published main `75f0caad1c3ea096a656feb2989b867781edc82f` because eleven actual
conflict paths required resolution. The original qualified commits remain in its ancestry.
Later extension source binding, await and ancestry work is excluded.

The conflict resolution retains main's planned return-attribute sources, pseudo attributes,
explicit-interface metadata names, unconditional module constructor, portable PDBs, and UTF-8
static data. Extension and fallback-attribute plans are registered before nullable planning and
token allocation. Grouping parameters use their normalized metadata redeclarations, while exact
markers retain source transforms. The original export author reviewed the reconstructed shared
metadata files and found no confirmed composition defect. That review did not execute tests.

The only additional pre-replay commit records two approved exact benchmark dynamic-import
allowlist entries. It preserves historical harness bytes, counts and hashes; the entries describe
trusted operator-selected local compiler paths honestly. The replay required no production fix.

```sh
DOTNET_ROOT=/workspace/scratch/1692a10afba9/toolchain/dotnet \
DOTNET=/workspace/scratch/1692a10afba9/toolchain/dotnet/dotnet \
SHARPFORGE_ORACLE_DOTNET=/workspace/scratch/1692a10afba9/toolchain/dotnet/dotnet \
node scripts/limited.js node --test --test-concurrency=1 \
  tests/compiler-exported-extension-blocks.test.js \
  tests/compiler-exported-extension-native.test.js \
  tests/compiler-declaration-ref-metadata.test.js \
  tests/compiler-declaration-ref-native.test.js \
  tests/compiler-extension-attributes.test.js \
  tests/compiler-extension-marker-identities.test.js \
  tests/compiler-extension-constraint-normalization.test.js \
  tests/compiler-nullable-empty-method-scopes.test.js \
  tests/compiler-attribute-targets.test.js
```

The scheduled serial run took 25.483 seconds. Real Roslyn consumers compile against implementation
and reference assemblies, then execute the original implementations. Native tests also cover
readonly/scoped signatures and virtual delegates, unmanaged constraint rejection, reflected fallback
attribute constructors, metadata marker throw bodies, static extension entry points, source attribute
targets, and normalized grouping constraints in both declaration orders. The existing nullable scope
control preserves 29 declaration records across registry/actual-PE and executable/reference surfaces.
Main's attribute-target tests retain both Invoke and EndInvoke return attributes.

Before execution, the installed SDK 10.0.201, CLR 10.0.5, Roslyn version and binary hash, and all
167 reference assembly hashes were verified against the repository pin. Full identities are in
`toolchain.json`. A preliminary checker accidentally compared a measured count/hash object with the
pin's additional descriptive algorithm field; this setup assertion and its narrow correction are
recorded in `preparation-notes.txt`. No test had started, and no product or oracle bytes changed.

All ten compiler transitive package aliases and public entry hashes remained unchanged before and
after the run, resolving inside this checkout. Every tracked compiler/dependency/helper/test/fixture
path in the verified scope matched the exact tested commit. Actual Node package resolution was also
checked. The before/after literal ESM import traversal reached 1,213 modules and 4,029 edges, with
no untracked module target.

External workspace synchronization repopulated excluded tracked files and unused untracked helpers
after a sparse cleanup. The pre-switch bytes were preserved in a separate archive; both replay
snapshots record 201 such paths. The tested tracked source scope stayed unchanged, and the immutable
publication tree contains none of those repopulated files. The complete materialized worktree is
therefore not described as continuously clean. The raw snapshots retain this environmental limit.

`replay.log` is unmodified test output. `summary.json`, the before/after alias snapshots, actual Node
resolution and toolchain identity record the result. This evidence commit changes no production
source, expected output or oracle. No benchmark or oracle capture was repeated.

The historical benchmark and implementation-author correctness-cost acceptance remain in
[the qualified export record](../../README.md). The final measured extension workloads cost
+36.67% / +39.20% median time, with +200% / +166.67% PE size; the ordinary control grows by
512 bytes / 25%. The earlier +16.58% ordinary median regression remains recorded. These are accepted
whole-composition correctness costs, not a performance-budget pass or isolated extension overhead.
Keep #664 open for the separate remaining source-language acceptance; this publication qualifies
export interoperability and shared declaration metadata only.
