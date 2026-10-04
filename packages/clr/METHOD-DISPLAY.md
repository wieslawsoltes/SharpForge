# Method and constructor display

`MethodDesc.toString()` returns a cached Reflection-style signature for the raw
MethodDef, including constructor and type-initializer rows. It composes the
existing signature AST, GenericParam ownership and CIL formatter callback;
no method body, referenced assembly or type hierarchy is loaded. `String(method)`
uses the same result. This is metadata display, not a ConstructorInfo wrapper,
member discovery, type binding, generic instantiation or invocation service.

The rules follow .NET 10.0.5 [RuntimeMethodInfo.ToString](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/System.Private.CoreLib/src/System/Reflection/RuntimeMethodInfo.CoreCLR.cs),
[RuntimeConstructorInfo.ToString](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/System.Private.CoreLib/src/System/Reflection/RuntimeConstructorInfo.CoreCLR.cs),
[Type.FormatTypeName](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Type.cs)
and [MethodBase.AppendParameters](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Reflection/MethodBase.cs).
Primitive element encodings use names such as `Int32`; Object and String remain
`System.Object` and `System.String`. Named metadata types retain namespaces,
while an outermost nested type uses its simple name. Generic methods use their
metadata parameter names, and constructed signatures use square brackets with
fully qualified arguments. Pointer/vector/default-bound multidimensional array
suffixes are retained. Byref parameters use ` ByRef`, return values retain `&`,
vararg declarations append `...`, and custom modifiers do not appear in the text.
Valid constructors display `Void .ctor(...)` or `Void .cctor()`.

`RuntimeModule.typeName(token)` is the underlying bounded TypeDef/TypeRef metadata
spelling query. It reuses the CIL reader's nesting index and returns names such as
`Namespace.Outer+Inner`. This does not resolve a TypeRef's assembly, certify its
existence or provide assembly-qualified reflection names. TypeSpec input rejects.
Its token extent, string and nesting failures remain explicit.

Forms needing additional runtime identity/formatting services fail with
`SFCLR012`: named aliases of CLI primitives, TypeSpec indirection, nested types
inside generic arguments, escaped type identifiers, function pointers, explicitly
sized/nonzero-bound arrays, explicit-this/unmanaged method conventions and
call-site vararg sentinels. General signature/MethodDef validity and equivalence
of alternative metadata encodings remain separate. No unsupported form silently
falls back to an inspection string. Malformed metadata and CIL signature-depth
failures use `SFCLR005`; the display's own size limits use `SFCLR007`.

Limits are 256 parameters, 1,024 visited display nodes, depth 32 and a 16,384
character formatting budget (including intermediate leaf/root projections).
Named components scan at most 16 KiB of UTF-8 and decode at most 4,096 UTF-16
characters; a metadata full name is at most 4,096 characters. TypeDef plus
NestedClass rows are capped at 100,000 before the shared nesting index allocates.
GenericParam plus constraint rows are capped at 4,096 for display; names are
preflighted before the existing generic index materializes descriptors. A failed
format publishes no display cache. Existing MethodDesc reads add no display work;
only the first display query adds the completed string to its private state.
The result remains usable while outstanding descriptors retain an unloaded context.

This implementation uses the public CIL `formatType` callback merged in #4211.
Authored tests and the independent
C# MethodInfo/ConstructorInfo fixture are prepared; native capture, focused tests,
new-API measurements and checks await the serial validation slot. There is no
native, performance or execution-engine qualification claim yet. #2475 remains
open for its broader reflection requirements.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-display.mjs tests/fixtures/clr-method-display/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-display*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-display.mjs
```
