# Prefix-group native reference

The prepared Reflection.Emit oracle records actual method bytes and invokes a
three-prefix volatile/unaligned/volatile indirect load. This exercises grouping
and binary fidelity against a native producer. Capture is pending; it does not
qualify every opcode-specific prefix combination or the ECMA no. prefix under CLR.

Build oracle/Prefixes.csproj with `--disable-build-servers -m:1` and isolated
temporary obj/output paths, run Prefixes.dll, and pin native.json during the
serial validation slot. Native runtime/tool versions will be recorded after capture.
