> 0.7 supplies native MSBuild execution/inspection through a local host, not a full browser reimplementation. Remaining build-related work includes native engine compatibility qualification, richer project/dependency and package UI, design-time Roslyn integration, native process debugging and workspace watching. See [current implementation](msbuild.md).

# Engineering roadmap toward the requested full system

This is a proposed next-work sequence, not a claim that the features below are already present or scheduled in the background.

## Completed in 0.6: checked resources and reversible IL

Checked int32 arithmetic and constant evaluation, concrete IDisposable using cleanup, per-project checked defaults, optional ordinary-IL reverse snapshots and write breakpoints, syntax/gutter viewport rendering, semantic selection/navigation history, additional safe refactorings, immutable model generation, and configurable unreachable-statement analysis. Full numeric/interface semantics, incremental parsing and arbitrary CLR compatibility remain separate work.

## Completed in 0.5: properties, finally and instruction debugging

Auto/computed property accessors and CLI property metadata; source finally/EH with nested unwind correctness; direct-CIL instruction debugger, docked bytes/offsets and stepping; primitive address opcodes; transactional structural refactorings; bounded editor find/replace/goto/brackets; packaged LSP/DAP stdio hosts; analyzer/task comments and schema auto-properties. See the current release and validation reports for exact tests and boundaries. General property/indexer/virtual semantics, CLR/PDB attach and full language conformance remain work.

## Completed in 0.4: project and docking workspace

Bounded csproj/slnx loading, project closure/configuration and CLI support; explicit conflict-checked source saving; 21 independent dockable tools, split editors and real same-origin browser popouts; multi-file partial classes, nameof and library cctors; literal cross-file search/validated replacement; source call hierarchy and LSP lenses; paged heap inspection, census and retaining paths. The release includes 14 source examples and seven project configurations. Full MSBuild/NuGet, separate-assembly linking, native docking, large-solution qualification and external protocol-client integration remain separate work.

## Completed in 0.3: broader DLL/IDE foundation

Ordinary metadata/IL inspection, conservative decompilation, metadata-preserving IL body assembly, bounded direct-CIL invocation, constant switch/casts/default/??=/unchecked, JavaScript generators/analyzers, transactional type rewrites and additional LSP methods are implemented. Remaining qualification includes real third-party DLL corpora, full verifier/type/dependency semantics, richer source reconstruction and source-debug mapping.

## Completed in 0.2: IL artifact path

Real PE/CLI emission; typed CIL method bodies; metadata and exception tables; canonical-profile IL loading; source/IL offset mapping; default IL execution in Studio and CLI; DLL import/export; source-free loading; decoded-module reuse; real CIL disassembly; 46 independent Mono/.NET execution fixtures; cold/warm benchmarks. This leaves general assembly loading, full CLR semantics and Portable PDB/native debugger integration open.

## 1. Establish a conformance baseline

Define a named executable language target and a feature/diagnostic matrix. Add differential tests against a pinned reference C# compiler and runtime, with expected divergences checked into the repository. Cover invalid programs as well as valid output. Correct namespace identity, accessibility, constant evaluation, overload resolution, conversion rules and flow analysis before expanding the language surface indiscriminately.

Acceptance: source/profile decisions are explicit, diagnostics and output are reproducible, and a feature only moves to supported after its semantic/error tests pass.

## 2. Make edit latency truly incremental

Replace positioned object ASTs with immutable width-based syntax nodes and lazy red wrappers. Add edit-local lexing, resumable lexical state, changed-subtree parsing and structural reuse. Separate declarations, body binding, control-flow graphs, lowering and emission into independently cacheable stages. Track declaration/dependency versions so edits invalidate only affected bodies and callers. Prioritize the active file and cancel obsolete work inside compilation stages.

Acceptance: edits in large projects reuse unaffected syntax and bound bodies, and p50/p95 latency is measured across realistic editing traces—not inferred from cache-hit microbenchmarks. Include malformed edits, cross-file API changes and cold-start performance.

## 3. Introduce a stable typed IR and runtime contracts

Create a standalone typed intermediate representation, explicit CFG, validated stack/exception regions and compiler-generated temporaries with liveness. Add a metadata model independent of the initial bytecode format. Define exact representation rules for value types, boxing, generic instantiations, virtual/interface calls, delegates, exceptions and type initialization.

Acceptance: a separate backend can consume IR without depending on AST internals, and the debugger maps source/bound symbols through lowering predictably.

## 4. Grow language and library compatibility

Extend properties to indexers/virtual dispatch; implement inheritance/interfaces, structs, generics, delegates/closures, patterns, iterators and async as cohesive vertical features. Each needs syntax, binding, lowering, runtime behavior, diagnostics, language-service support and debugger tests. Add library profiles with clearly named compatibility levels. The separate PE/CIL backend and canonical-profile browser loader are present in 0.2. Extend them through general metadata/type loading, independent instruction lowering, Portable PDBs and broader differential tests rather than treating an emitted DLL as proof of full CLR semantics.

Acceptance: features are usable end to end, not merely accepted by the parser.

## 5. Improve execution and collection with evidence

Benchmark representation changes and dispatch overhead. Evaluate register bytecode, specialization, compact heap storage, write barriers, generational collection and incremental GC. A Wasm backend/JIT could complement the JavaScript frontend, but is not present in this release. Keep debug-mode source fidelity and safety checks measurable separately from optimized execution.

Acceptance: performance claims include corpus, environment, warmup, allocation and latency distributions; improvements do not silently change language semantics.

## 6. Complete IDE and debugger integration

Ship real protocol transports and tested editor adapters. Extend breakpoint identities, generation-safe data-breakpoint persistence, expression binding, async stacks, richer inspection paging, structured exception trees, cancellation, diagnostics deltas, code actions, rename and formatting. Add recoverable worker supervision and large-workspace persistence. Define the legality of hot-reload changes before implementing state migration.

Acceptance: external clients pass integration suites; native/CLR attachment, hot reload and full Visual Studio UI parity remain separate explicit projects rather than implied capabilities.
