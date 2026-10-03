# SharpForge 0.10.0

Built on the verified 0.9 source. This release delivers Portable PDB symbols, cooperative async/task/thread execution and inspection, compatible managed Hot Reload, explicitly consented effectful evaluation, guarded Set Next Statement, and code-first WinUI-shaped web applications. The implementations are integrated with Studio, workers, direct CIL, the source VM, CLI and DAP; they are not native CLR or complete Windows App SDK implementations.

## Highlights

- Standard Portable PDB table/sequence/local/import/state-machine/CDI reader; deterministic emitter; external/embedded symbols, PE identity/checksum validation, source checksums and independent verified source editor. Large-document mapping uses per-document indexes rather than repeated scans.
- Closed Task/Task<T>/async-void method lowering, managed delegates, actual parked stacks, shared-heap cooperative task/thread contexts, timers, waits, GC/reverse integration, freeze/thaw and await-aware stepping.
- Transactional compatible code replacement, validation before mutation and explicit code generations. UI-handler Hot Reload preserves the live window and application state.
- Explicit method/property/constructor/assignment evaluation with consent, preview rollback and bounded execution. Automatic watches stay side-effect-free.
- Safe source/IL instruction relocation at validated locations, without restarting a frame.
- Code-first C# WinUI-shaped controls and managed callbacks with DOM layout/input; real WebGPU primitive pipeline and Canvas2D/DOM fallback paths. Separately reusable JavaScript namespace facade.
- Seven new docking tools, for 36 total; 20 packages; 10 new examples, for 47 total (46 executable plus intentional diagnostics).
- AsyncWorkshop, WinUICounter and SymbolWorkshop disk project/solution examples; no-#SF PortableSymbols DLL plus PDB/source fixture; generated API inventory with exact contracts.

## Start

Open the standalone HTML or serve `dist/`. From source, run `npm ci --offline --ignore-scripts --no-audit --no-fund`, then `npm start`. Choose WinUI counter and Window → WinUI application layout. Debugger examples have useful preset breakpoints. For headless async execution, run `node apps/cli/main.js run examples/projects/AsyncWorkshop/AsyncWorkshop.slnx`.

See [the feature/workflow guide](advanced-debugging-winui.md), [API inventory](winui-api.md), and [validation](validation-0.10.0.md) before relying on compatibility or platform claims. Native CLR/WinRT/OS-thread execution, Windows PDBs, general Roslyn Edit-and-Continue deltas and arbitrary unsupported C#/BCL/native function evaluation are not implemented. Actual SDK builds, external IDE clients and physical WebGPU hardware were not qualified in this environment.
