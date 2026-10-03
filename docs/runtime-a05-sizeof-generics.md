# Generic sizeof admission

This E01 follow-up covers the `sizeof` intersection of SF-A05-T02.3 (#1356)
and SF-A05-T03.3 (#1366). It depends on the assembled E01 generic frames and
value-layout implementation; main's primitive-only interpreter does not yet
have those prerequisites.

The CIL profile accepts closed internal structs, enums, Nullable instantiations,
supported primitive and reference types, arrays, and `!n`/`!!n` declared by the
containing type or method. Runtime substitution selects the concrete layout;
cache entries remain keyed by the closed MethodTable. A reference operand,
including a generic parameter instantiated with a class, reports the configured
native reference size. It does not measure the referenced object.

This follows ECMA-335 III.4.25 and Microsoft's
[OpCodes.Sizeof contract](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.sizeof).
CLI reference operands are supported independently of C# source restrictions.

Malformed tokens, missing generic arguments and out-of-scope parameters retain
verifier diagnostics. Open runtime layouts and malformed Nullable arguments
raise managed layout faults. Byrefs, raw pointer operands, typed references,
ref-struct layouts and unknown external layouts remain outside this execution
profile; the change does not guess their size. Existing sequential alignment,
packing, explicit offsets and class-size calculations are reused.

`tests/a05-sizeof-generics.test.js` adds independently assembled TypeSpec and
MethodSpec calls, both native widths, repeated instantiations, layout failures,
and source/reloaded-source/direct-CIL checks for existing primitive constants.
General C# generic/struct sizeof lowering remains outside this slice.

`tests/fixtures/a05/sizeof-generics` is a Roslyn/native differential fixture.
Its reference-size assertions work on either native width. The fixture and
regressions were prepared without executing validation; the root serial queue
owns Node and .NET qualification. No native, browser or Rust pass is claimed.
