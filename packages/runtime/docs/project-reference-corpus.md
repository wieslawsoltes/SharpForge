# Closed project assembly qualification corpus

These six unchanged tests preserve the completed cross-project compiler, CIL loader,
metadata-access, initialization and runtime acceptance scope. They build separate
SharpForge PE images and exercise actual consumer boundaries; dependency source is
never concatenated into the application.

The corpus covers all six external operations, transitive graphs, aliases and full
assembly identity, stale hashes, canonical metadata and resource provenance, private
and internal access, friend assemblies, readonly fields, all six accessor access
kinds, implicit constructors, initialization order and cached initializer failures.
The native cases compare separately emitted assemblies on Roslyn, the installed CLR,
and both JavaScript execution engines. The shared native helper uses installed SDK
reference packs and the compiler directly, without a package restore.

## Recorded qualification

The source composition is `c1a662d18d31e202a6b420bce1e9177b0b1a50ba`.
The retained qualification consists of the full Node 26 scope (415/415), the final
affected Node 22 correction scope (68/68), and the current integration correction
scope (77/77) following the recorded 794-test run (788 passes and six subsequently
corrected failures). These are scope totals, not a claim that this subset has 415 tests.
The actual package-free CLR oracle exercised separate library/application images;
its readonly case used SDK 10.0.201 and runtime 10.0.12 on Linux x64. Earlier failures
and their corrections remain in the project-runtime evidence. This publication adds
no repeated local test, restore or build run.

Use `node scripts/limited.js node --test` with the six `tests/a23-project-*.test.js`
and `tests/a23-source-member-definitions.test.js` paths added by this change. Set
`SHARPFORGE_DOTNET` to an installed dotnet host and `SHARPFORGE_NATIVE_SDK` for the
readonly metadata oracle. A missing native prerequisite is reported as a skip.

Arbitrary external CLR assemblies remain outside the closed supplied-image execution
profile. Linux x64 results do not qualify Windows, macOS or arm64. The readonly
negative cases retain CS0191 for instance writes and CS0198 for static writes;
SharpForge reports CS0272 for an inaccessible setter where the recorded Roslyn
reference reports CS0200. Public NuGet/framework package qualification is separate
and is not implied by this offline corpus.
