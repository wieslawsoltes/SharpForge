# Prefix-group native reference

The prepared Reflection.Emit oracle records actual method bytes and invokes a
three-prefix volatile/unaligned/volatile indirect load. This exercises grouping
and binary fidelity against a native producer. Captured with SDK 10.0.201 / .NET 10.0.5 on macOS ARM64; it does not
qualify every opcode-specific prefix combination or the ECMA no. prefix under CLR.

Build oracle/Prefixes.csproj with `--disable-build-servers -m:1` and isolated
temporary obj/output paths, run Prefixes.dll, and pin native.json during the
serial validation slot. Native execution returns 42; build has zero warnings/errors.
