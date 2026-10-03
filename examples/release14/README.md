# 0.14 language and runtime examples

Every directory is a complete code-based SharpForge csproj/slnx workspace. Matching ZIPs are under `zips/`. The same eight programs are in Studio's Examples menu. Project templates use the SharpForge browser profile; generated native target-framework labels do not guarantee ordinary .NET compilation of SharpForge extension contracts.

| Project | Demonstrates | Execution |
|---|---|---|
| CsharpModernProperties | field-backed properties, target-typed construction, null-conditional assignment | 14 default; output 42 and 0 |
| CsharpPreviewCollections | collection spreads/capacity arguments and named loop jumps | explicit LangVersion preview |
| BclJsonDocument | JSON traversal/raw values/serialization | bounded document ownership |
| BclArrayRandom | overlapping copy, fills, searches and seeded state | deterministic seed |
| SimdVectorMath | Vector<int>/Vector<double> arithmetic and reductions | actual WASM or explicit scalar fallback |
| ParallelCompute | async numerical calls with owned arrays | real isolated numerical workers |
| NetworkHttpClient | explicit HTTP request and JSON response | denied unless user grants the origin |
| WinuiComputeMonitor | existing code-first UI updating after an async calculation | actual worker-backed button handler |

Run `node apps/cli/main.js run examples/release14/ParallelCompute/ParallelCompute.slnx` from the repository root. For networking, explicitly run `node scripts/network-example-server.js` separately, then run the NetworkHttpClient solution with `--allow-origin http://127.0.0.1:8787`. A browser also needs the server CSP and the session grant; see the [guide](../../docs/language-runtime-networking.md). No grant is stored in these example archives. `npm run examples:release14` rebuilds the folders/ZIPs from the authored source examples.
