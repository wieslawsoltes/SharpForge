# SharpForge 0.14.0 — language, BCL and host runtime

Date: 2026-10-03. Built from the delivered 0.13 source, whose 2,264-test baseline passed before implementation. No GitHub or registry publication is performed by packaging this release.

## Delivered capabilities

Selected C#14 features: field-backed properties, null-conditional assignment statements. Earlier common features: target-typed new and collection expressions/spreads. C#15 preview capacity arguments and labeled break/continue require explicit preview; csproj LangVersion is respected independently by source-combined projects. Historical gates are selective, not complete language-version emulation.

Additional BCL contracts include overlap-safe Array helpers, heap-owned seeded Random, bounded System.Text.Json DOM/enumeration/serialization, Uri, buffered HttpClient/content/messages/headers/status and explicit cancellation. Existing collections now avoid repeated linear property/index work: canonical dispatch, cached record slots, incremental dictionary/set indexes and ring-buffer Queue. All new language/example scenarios run through source VM, canonical CIL reload, direct CIL and exported/reassembled IL.

New reusable @sharpforge/compute provides actual i32x4/f64x2 WASM SIMD and scalar kernels plus real isolated numerical workers. Vector<int>/Vector<double> and ParallelMath awaitable double-array operations integrate with both engines. Inputs and results are owned/transferred copies; caller buffers and managed heaps are not shared. Worker queues, bytes, deadlines, cancellation/replacement and failure cleanup are bounded. Native C# OS threading/Parallel.For/general memory sharing remain unsupported.

New @sharpforge/network provides default-deny exact-origin HTTP and JavaScript WebSocket clients. Managed HttpClient uses actual Fetch with cancellation/limits, not simulated data. Credentials omit, redirect rejection, header restrictions and CORS/CSP remain in effect for HTTP. Browser WebSocket credentials remain browser-controlled. JavaScript WebSocket is not a managed ClientWebSocket or raw TCP/UDP implementation. The IDE and server require independent explicit networking grants; ZIP/recovery cannot restore grants.

External operations retain GC roots and own cancellation. Epoch boundaries prevent reverse execution/restoration and noncommitted evaluation from replaying or undoing external effects. Old-generation completions are ignored. Observer faults cannot orphan native tasks. The collector remains mark-and-sweep, not concurrent/compacting.

Language & Runtime is a new docking tool for language gates, numerical backend, real worker/pending/copy metrics, session grants and revoke/stop. Visual Studio remains the default keymap. The prior designer, two-way C# sync, animation/style/layout systems, Hot Reload and debugger remain integrated. Studio has 44 tools, 52 toolbox entries, 68 examples (67 runnable plus diagnostics). Eight new complete csproj/slnx/ZIP projects cover modern/preview language, JSON, arrays/random, SIMD, isolated async compute, HTTP and a WinUI compute handler.

## Validation and performance

2,574 Node tests pass (310 added), 232 JavaScript modules syntax-check, all 14 browser suites pass 329 checks, standalone passes 61 checks with real workers, all 25 packages install/run offline in an isolated project. The new 17-check browser suite uses real worker kernels and actual browser Fetch to a CORS-enabled loopback HTTP endpoint. Node tests exchange real text/binary WebSocket frames with an authored test server. No physical WebGPU or native SDK build success is claimed.

Same-runner local measurements improve the dictionary, list, queue and builder workloads; small SIMD calls can be slower because of copying/dispatch. See performance-0.14.0.md for all eight VM workload comparisons, scalar/WASM data, worker startup time, method and caveats. No native .NET performance comparison or unconditional speedup is claimed.

## Remaining boundaries

This is not complete C#14/15, BCL, CLR, Visual Studio, Windows App SDK, OS-thread or socket parity. General generics/inheritance/ref structs/LINQ, extension members, all preview features, general JIT/GC work, raw sockets/native networking, native debugger attachment and native CLR update deltas remain incomplete. Normal browser HTTP navigation was blocked by runner policy; the browser UI was injected through the documented harness, while its local HTTP requests were real ordinary Fetch. Native dialogs, durable browser storage, native CLR/SDK/PDB interoperability, external IDE clients, physical WebGPU and remote TLS services were not qualified here.

See language-runtime-networking.md, runtime14-api.md, validation-0.14.0.md, performance-0.14.0.md and examples/release14/README.md. Delivered source archive qualification is recorded separately after exact extraction; no inaccessible working-tree snapshot is substituted for the downloadable source.
