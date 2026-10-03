# Reflection.Emit opcode metadata

Prepared for serial validation. Build `oracle/Opcodes.csproj` with SDK 10.0.201 using
`--disable-build-servers -m:1` and isolated `/tmp` output/obj paths, then run it under
.NET 10.0.5 and capture `native.json`. The oracle reads real public OpCodes fields and
records exact enum names, encoded values and sizes.

The active native entries are compared field-for-field. Reserved internal `prefix1` through
`prefix7` and `prefixref` are captured but remain rejected by the binary codec. The existing
ECMA `no.` prefix is separately specified because CoreCLR's opcode table marks its slot
unused. This metadata does not establish verifier legality or runtime execution support.

Implementation facts are aligned with dotnet/runtime v10.0.5 `src/coreclr/inc/opcode.def`
and ECMA-335 III. Native observation counts and focused validation remain pending.
