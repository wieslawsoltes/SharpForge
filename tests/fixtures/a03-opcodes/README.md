# Reflection.Emit opcode metadata

Captured on macOS ARM64 with SDK 10.0.201 / runtime 10.0.5. Build `oracle/Opcodes.csproj` with SDK 10.0.201 using
`--disable-build-servers -m:1` and isolated `/tmp` output/obj paths, then run it under
.NET 10.0.5 and capture `native.json`. The oracle reads real public OpCodes fields and
records exact enum names, encoded values and sizes.

The active native entries are compared field-for-field. Reserved internal `prefix1` through
`prefix7` and `prefixref` are captured but remain rejected by the binary codec. The existing
ECMA `no.` prefix is separately specified because CoreCLR's opcode table marks its slot
unused. This metadata does not establish verifier legality or runtime execution support.

Implementation facts are aligned with dotnet/runtime v10.0.5 `src/coreclr/inc/opcode.def`
and ECMA-335 III. All 218 active native descriptors match exactly, 8 reserved
internal descriptors are excluded, and all 219 supported binary forms round-trip.
The focused CIL/API run passed 197 of 198 tests. Its sole A05 handler test failure
expects NotSupportedException for unknown.op, while the runtime emits
InvalidProgramException; restoring baseline e85fb905 opcodes.js reproduces that
same failure. All 4 new opcode tests and all 190 cil.test.js tests pass.
Required check passes (2109 syntax / 2105 static modules, zero errors); structure
reports no findings for changed/new opcode files. JSON formatting uses one
descriptor per line after capture; values are the unmodified native observation.
