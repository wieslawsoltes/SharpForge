# Module-only SRM reference

Prepared, not yet validated. `prepare.js` emits AnyCPU/x86/x64/ARM64 module-only PE images.
The .NET 10 SRM/PEReader oracle confirms the Module name, absence of an Assembly table,
zero entry point and type definitions. It does not load or execute a multi-module assembly.

Run the generator through `scripts/limited.js`; build `oracle/Modules.csproj` using
`--disable-build-servers -m:1` and isolated `/tmp` output/obj; run the oracle on generated
`.netmodule` files to capture `native.json`. No broad browser/native platform claim is made.
