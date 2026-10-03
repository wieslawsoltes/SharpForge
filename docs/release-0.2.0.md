# SharpForge 0.2.0 — IL artifact release

Adds the reusable `@sharpforge/cil` module and real ECMA-335 PE/CLI output. The CLI and Studio use DLLs by default; the original fixed-width VM instructions remain the internal predecoded execution representation. Analysis stays independent of binary emission.

Major paths: `compileToIL`, typed CIL lowering, standard metadata/signatures/EH, deterministic PE serialization, bounded profile loading with canonical verification, module reuse, actual IL disassembly, source/IL debugging maps, DLL import/export, source-free execution, and DLL-based DAP launch. Fixes include double literal identity, startup return signatures, signed versus unordered comparisons, typed assignment stores, Workspace option-cache identity and paused-frame IL offsets.

Local validation: 305 core tests, 29 real-worker browser checks, standalone smoke checks, all eleven packages installed/executed offline in isolation, and 46 independent Mono/.NET WASM return-value fixtures. The native test environment uses a test-only reference-forwarding facade because its framework is trimmed. Full desktop .NET, ILVerify, normal browser-origin/persistence and hosted CI remain unverified.

Performance: preserve the VM hot loop and managed collection behavior; pay PE emission and fresh module loading/verification outside that loop. All three recorded paired runs are retained, including the initial 14.8% allocation slowdown. This is not a guarantee of identical timing or reduced binary size. Detailed startup costs and large debug-metadata overhead are in `il-performance.md`.

Profile boundaries: no general external DLL/NuGet loading, Portable PDB support, full CLR boxing/type semantics, additional C# language conformance, native attach or JIT. Browser loading requires canonical SharpForge output and its `#SF` mappings; `--native-only` removes them and disables browser loading. See `il-backend.md`, `compatibility.md` and `validation.md` for the precise contracts.
