# UTF-8 publication replay, 2026-10-04

The exact publication merge `03bc06bff6d2fef444ceb6f9be56b5a12d65c509`
(tree `5b73766b6223bfe766566a5c7e17b40660bbb326`) passed **12/12 focused tests, zero skips**.
Its parents are the qualified UTF-8 branch `b1bcaf51e4900721631b6770bbc83b8c8df9cbe1`
and published main `7f4af78df79e3eac36302c50e0a589e0ce9e83ac`.
The merge retains main's unconditional module initializer, both dynamic and UTF-8 synthesized
type contributions, and every existing static-import manifest entry. No new production fix was
needed during this replay. This evidence commit changes no tested source.

```sh
DOTNET_ROOT=/workspace/scratch/1692a10afba9/toolchain/dotnet \
DOTNET=/workspace/scratch/1692a10afba9/toolchain/dotnet/dotnet \
SHARPFORGE_ORACLE_DOTNET=/workspace/scratch/1692a10afba9/toolchain/dotnet/dotnet \
node scripts/limited.js node --test --test-concurrency=1 \
  tests/compiler-cil-utf8-rva.test.js \
  tests/compiler-cil-utf8-rva-reference.test.js \
  tests/compiler-cil-utf8-rva-native.test.js
```

The scheduled run was serial and took 7.489 seconds. The native test verifies the pinned SDK
10.0.201, CLR 10.0.5, Roslyn compiler identity/hash, and all 167 reference assemblies before use.
It compiles the independent consumer with real Roslyn and executes three new SharpForge libraries:
registry, actual references, and the controlled missing-optional-constructor fallback. Both static-data
modes allocated zero bytes across 10,000 literal calls. The fallback allocated 400,000 bytes versus
the captured Roslyn 1,120,000 bytes; all functional output lines match. Different valid fallback
initialization strategies are already explained by the original fixture and are not a throughput claim.
The focused tests also retain exact required-member diagnostics and repeated-site source ranges,
FieldRVA/terminal-zero layout, executable/reference assembly behavior, and explicit bytecode rejection.
No oracle was recaptured and no benchmark was rerun.

Before and after the run, all ten compiler transitive package aliases and public entry hashes were
identical and resolved inside this checkout. Every tracked compiler, dependency, helper, fixture and
test path in the recorded scope matched the exact tested commit. Actual Node package resolution was
checked before execution. The currently published package manifests contain fifteen dependency edges.

The complete materialized worktree did not stay clean: an external workspace synchronization process
repopulated excluded tracked files and untracked files after a sparse cleanup. Their bytes were
preserved in a separate archive before cleanup. The recorded before/after snapshots each show 232
such paths; 54 are unused untracked source helpers from other preserved work. A read-only traversal
of literal ESM imports/exports from the package entries and tests reached 1,198 modules and 3,955
edges, with no untracked module target. The tested tracked sources stayed unchanged. The immutable
publication tree contains only the intended feature and main merge, with no repopulated files staged.
This limitation is recorded explicitly rather than calling the entire materialized worktree clean.

`replay.log` is unmodified test output. `summary.json` records the command, native identities and result;
`aliases-before.json`, `aliases-after.json`, `node-resolution.json` and `source-imports.json` record the
checkout checks. The existing paired benchmark and explicit cached-reference control regression
sign-off remain in `../../benchmark/README.md`; this correctness replay adds no performance claim.
