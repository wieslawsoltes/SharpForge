# Branch-layout native reference

The fixture writes ordinary CIL through `finishWithLayout`, then uses the existing
managed-fixture PE builder. Native .NET execution checks a 300-byte forward/backward
branch method, 127/128-byte forward boundaries, and a relocated switch target.
It tests resulting binary behavior, not verifier or compiler relocation integration.

Capture is pending. Run prepare.js through scripts/limited.js with a temporary DLL
path, build oracle/Layout.csproj with `--disable-build-servers -m:1` and isolated
temporary obj/output paths, then pass the generated DLL to Layout.dll. Pin the
native JSON and actual runtime version after the serial validation slot.
