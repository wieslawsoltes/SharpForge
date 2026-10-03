# Two-module manifest reference

Captured on SDK 10.0.201 / .NET 10.0.5, macOS ARM64. Native SRM confirms both
SHA-256 hashes and actual TypeDef row hints; the nested export targets its parent.
Roslyn reports version 5.3.0-2.26153.122 (4d3023de605a78ba3e59e50c657eed70f125c68a).
The Alpha module is emitted by SharpForge. Beta is compiled with SDK 10.0.201 Roslyn
from `Beta.cs`, including public/private nested types and an internal enclosing type.
The generated manifest links both. Native SRM checks File hashes using .NET SHA256,
actual TypeDef row hints and exported names; it never loads or executes either module.

Capture on macOS ARM64 with SDK 10.0.201 / runtime 10.0.5:

1. Run SDK `Roslyn/bincore/csc.dll` on `Beta.cs` with `-noconfig -nostdlib -target:module`,
   reference-pack `System.Runtime.dll`, and `-out:/tmp/a03-linking-beta/Beta.netmodule`.
2. Run `prepare.js /tmp/a03-linking-input /tmp/a03-linking-beta/Beta.netmodule` through
   `node scripts/limited.js` using Node 24.
3. Build `oracle/Linking.csproj` with `--disable-build-servers -m:1` and isolated `/tmp`
   output/obj paths; run on `/tmp/a03-linking-input/Manifest.dll` and capture `native.json`.

No CLR module resolution, compiler binding, browser or native execution claim is made.
