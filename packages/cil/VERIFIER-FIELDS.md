# Typed field and nominal CIL verification

`verifyCilMethodTypes(bytesOrInspector, methodToken, { coreTypes, ...options })`
now verifies `ldfld`, `stfld`, `ldflda`, `ldsfld`, `stsfld` and `ldsflda` through
the existing bounded typed worklist. The input/core identity authority is the
[metadata category contract](VERIFIER-TYPE-SYSTEM.md); names and signature tags
alone never establish object/value representation. The method, field owner and
nominal storage types reuse the combined context's canonical local handles.
Local Module-scoped TypeRef aliases use the same existing resolver.

Methods requiring field metadata, local nominal storage or normal instance
state report the additive profile `SharpForge.TypedCIL.Fields/1`. Pure numeric
methods retain `SharpForge.TypedCIL.Numeric/1`. Neither profile grants runtime
admission or claims complete verification. Status and diagnostic result shapes
are unchanged; unresolved identity/category/access facts return `unknown`.

The policy checks field receivers, static opcode requirements, field-value
assignment, existing lexical/family accessibility, and init-only writes.
Ordinary reference-class instance methods receive their canonical object `this`;
non-enum value-type methods receive a managed pointer. Receiver subclasses,
nominal arguments/locals/returns and reference joins use the same metadata
relations as field assignment. Null object receivers are verifiable even though
execution throws. A value copy may be read with `ldfld`; writing/addressing that
copy remains unknown until lifetime policies exist. A managed pointer to a
reference variable is not an object receiver.

Init-only stores are rejected except a static field written by its own valid
static `.cctor` (static, special-name/runtime-special-name, no arguments, void).
Normal instance methods cannot write instance init-only fields. Instance `.ctor`
methods remain `unknown` because uninitialized-this and constructor transitions
are not implemented. Both field-address instructions reject init-only fields,
following ECMA III.4.11/III.4.15. Pinned ILVerify 10.0.5 leaves the instance
`ldflda` init-only check unimplemented; the fixture declares that disagreement
before capture. Native acceptance does not weaken this policy.

An optional trusted boolean `coreTypes.sameModule` proves whether the input and
declared core contexts describe the exact same module. Only explicit `false`
plus a completely resolved core class chain to the validated Object root can
close an external base edge for a negative local-class ancestry result.
`true`/absent facts, unprepared bindings and unresolved interface paths preserve
unknown. Nonboolean facts and contradictory local TypeDef bindings are invalid.
Foreign handles never become local tokens or member owners. One boolean fact is
stored on existing records; no second identity or ancestor registry is added.

Metadata snapshots are lazy per verifier invocation, with the existing type,
member, signature, query and cancellation limits. Field preparation is cached
per referenced token, bounded by the existing member-table count. Scalar and
primitive address values reuse the existing canonical slots. Nominal storage
and block joins share `state.relations`; local definite-assignment hooks and
copy-on-write block state are unchanged. Unknown facts never count as successful
stores or initialization.

This is a partial #2403 batch. Calls/newobj, casts, boxing/unboxing, arrays,
generic substitution, enum storage normalization, external nominal assignment,
explicit-layout instance fields, RVA storage, byref returns/lifetimes, EH and
instance constructor state remain unsupported. Intrinsic Object/String versus
local nominal normalization remains unknown except assignment to intrinsic
Object. Other object opcodes stay open, and #2405 constructor acceptance is not
closed by supporting normal instance methods or static constructors.

Rules: [ECMA-335 sixth edition](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
III.4.10–4.15 and III.4.28/4.30, and the
[pinned ILVerify field importer](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/tools/ILVerification/ILImporter.Verify.cs).
Evidence and reproduction commands belong in
[the focused fixture README](../../tests/fixtures/verifier-fields/README.md).
