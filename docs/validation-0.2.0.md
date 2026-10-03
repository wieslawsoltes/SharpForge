# Local validation — SharpForge 0.2.0 / IL backend

Recorded on 1 October 2026. These are results for the included C# subset and `SharpForge.CIL/1` producer/loader profile, not full C#/CLI/Visual Studio conformance.

## Results

| Layer | Actual result | Evidence |
| --- | --- | --- |
| Core/unit/regression suite | **305 passed**, zero failures/skips | `core-results.tap` |
| JavaScript parsing | All source/test/build scripts pass `node --check` | `npm run check` |
| Browser acceptance | **29 passed**, two real compiler/runtime workers, no JavaScript errors | `browser-results.json` |
| Standalone HTML | Real PE/CLI compilation, IL execution, source breakpoint and both workers pass | `standalone-results.json` |
| Independent managed runtime | **46/46 emitted assemblies passed** on Mono .NET WASM 9.0.17, with the test-only reference facade described below | `clr-wasm-results.json` |
| Reusable packages | **All 11 version-0.2.0 tarballs** install/import offline in an isolated project; compile DLL, decode it, execute 42 and disassemble actual CIL | `package-results.json` |
| CLI | Default DLL + runtimeconfig, source run, binary exec, actual CIL disassembly, explicit legacy IR and error paths pass | `tests/cil-cli.test.js` |
| Performance | Three paired warm execution/pipeline benchmark runs retained | `il-performance.md`, `il-benchmark*.json` |

Node v22.16.0, Linux x64. Chromium 144.0.7559.96, headless Python Playwright. The original 170 core tests remain in the suite.

## IL validation covered

Actual PE/CLI signatures/metadata/method bodies, valid typed numeric lowering, true wide metadata heaps, UTF-16 user strings, branch/handler targets, constructor/field/array lowering, protected-region returns/break/continue, signed and unordered floating comparisons, startup return types, deterministic output, source-free loading, forged metadata/opcode/span rejection, strict canonical verification, IL/IR execution equivalence fixtures, VM instruction counts, debugger stepping/locals/watches/reverse snapshots, IL method tokens/offsets, DAP DLL launches from typed/buffer/JSON transports, malformed transport rejection and Workspace option-cache invalidation.

The 29 browser checks retain all original functionality tests, now running through real DLLs. New checks verify `MZ` PE bytes, runtime artifact format, initial load versus reused decoded module, source breakpoint frames with real IL offsets, CIL/IR disassembly switching, downloaded DLL bytes, imported DLL execution without rebuilding source, and a source-free DLL that executes despite there being no executable source in the editor. Desktop, dark/light, 390-pixel mobile and 850-pixel tablet layouts are exercised.

The compiler tests include a deterministic 300-input punctuation-fuzz loop inside one test; this does not inflate the 305-test count or constitute a security audit.

## Independent Mono/.NET verification — exact scope

The environment had no usable desktop `dotnet` host but did contain a preinstalled **trimmed Mono .NET WASM 9.0.17 Release** runtime with SIMD and WASM exception support. `scripts/validate-clr-wasm.js` loaded the emitted default-net8 DLL bytes into that **independent runtime**, not into SharpForge's interpreter. Forty-six output-free programs returned the expected values; they cover arithmetic/overflow, signed/floating comparisons and NaN, calls/recursion/overloads, constructors/fields/initializers, arrays, loops, try/catch/rethrow/protected returns and empty Main arguments.

The trimmed installation omits the standard `System.Runtime` facade and many Console/BCL overloads. The harness therefore supplies a **test-only metadata facade** forwarding referenced System.Runtime types to the installed System.Private.CoreLib 9 assembly. It contains no implementation of the tested methods/program logic. The original emitted program bytes are not rewritten. No framework binaries are included in this release. The facade is kept under `tests/support/`, is not part of the CIL/runtime packages, and is not a replacement BCL or a production deployment component.

Consequently, **46 successful independent execution checks do not establish full desktop CoreCLR loading, all Console/BCL methods, every accepted program, ILVerify results, reflection interoperability, or arbitrary assembly compatibility**. The full-framework script `npm run test:dotnet` defines 89 return/output fixtures and CI jobs are configured for .NET 8/10, but neither that desktop script nor hosted CI was executed in this environment. The alternate mscorlib4 reference profile was not executed against .NET Framework.

Reproduce on a compatible existing WASM framework directory:

```sh
DOTNET_WASM_DIR=/path/to/published/_framework npm run test:clr-wasm
```

This adapter was tested against the installed .NET 9 manifest layout, not every .NET web publish variant. To validate against your full installed framework:

```sh
npm run test:dotnet
# Set DOTNET_PATH when the host is not named `dotnet` on PATH.
```

## Browser environment boundary

Enterprise policy blocked browser URL navigation, including localhost. It was not changed. `SHARPFORGE_IN_MEMORY=1` loads the built HTML/CSS/module graph into an `about:blank` page and runs the **actual production compiler/runtime worker bundles**, without mocks or network requests. Its memory-storage shim is test-only. The standalone smoke test injects the self-contained HTML directly without that shim; application storage failures are handled normally.

Normal HTTP/HTTPS-origin browser loading, local-file worker policy, native persistence, hosted deployment, Firefox, Safari, touch hardware, accessibility tools and real Visual Studio/LSP/DAP clients are **not verified**. The CI browser job is configured for real localhost HTTP, but has not been run on a hosted repository for this release.

## Reproduce core/package/browser validation

```sh
npm ci --ignore-scripts --offline --no-audit --no-fund
npm run check
npm test
npm run test:packages
npm run build
node scripts/standalone.js
node apps/cli/main.js run examples/particles/Program.cs examples/particles/Particle.cs
```

The JavaScript workspace has no external registry dependencies. Package verification packs all siblings, installs the archives together in a separate temporary project with offline npm, imports every public entry point, then compiles/loads/runs/disassembles an actual DLL. These packages are not registry-published.

Python Playwright is a separate optional testing dependency:

```sh
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
npm run test:browser
npm run test:standalone
```

For the restricted-runner mode used here:

```sh
SHARPFORGE_IN_MEMORY=1 CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:standalone
```

`test:browser` normally starts its HTTP server automatically. `test:standalone` intentionally does not validate native file-URL policy. See `security.md` and `compatibility.md` before hosting untrusted source or DLLs.
