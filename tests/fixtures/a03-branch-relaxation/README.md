# Branch-layout native reference

The fixture writes ordinary CIL through `finishWithLayout`, then uses the existing
managed-fixture PE builder. Native .NET execution checks a 300-byte forward/backward
branch method, 127/128-byte forward boundaries, and a relocated switch target.
It tests resulting binary behavior, not verifier or compiler relocation integration.

Captured with SDK 10.0.201 / .NET 10.0.5 on macOS ARM64. All four native
invocations match the direct CIL fixture results in native.json; the oracle build
has zero warnings and zero errors. Run prepare.js through scripts/limited.js with
a temporary DLL path, build oracle/Layout.csproj with `--disable-build-servers -m:1`
and isolated temporary obj/output paths, then pass the DLL to Layout.dll.
