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
fully qualified arguments. Nested types inside generic arguments retain their
enclosing `Outer+Inner` spelling and any inherited/own generic argument positions;
outermost nested signatures still use Reflection's historical simple-name rule.
Pointer/vector/default-bound multidimensional array
suffixes are retained. Byref parameters use ` ByRef`, return values retain `&`,
vararg declarations append `...`, and custom modifiers do not appear in the text.
Valid constructors display `Void .ctor(...)` or `Void .cctor()`.

`RuntimeModule.typeName(token)` is the underlying bounded TypeDef/TypeRef metadata
spelling query. It reuses the CIL reader's nesting index and returns names such as
`Namespace.Outer+Inner`. This does not resolve a TypeRef's assembly, certify its
existence or provide assembly-qualified reflection names. TypeSpec input rejects.
Its token extent, string and nesting failures remain explicit.

Forms needing additional runtime identity/formatting services fail with
`SFCLR012`: named aliases of CLI primitives, TypeSpec indirection,
escaped type identifiers, function pointers, explicitly
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
The independent C# MethodInfo/ConstructorInfo fixture captured 18 method/constructor
strings on SDK 10.0.201, Roslyn 5.3.0-2.26153.122 and CoreCLR 10.0.5. The committed
capture records source/image hashes, toolchain and environment. All 8 focused
tests passed with zero skips on Node 24.21.0; the final mandatory-oracle test also
passed after removing its draft-only skip. Static/manifests checked 3,263 modules
with no syntax errors and 3,259 modules with no static errors. Structure reported
269 existing findings, none in changed files. Source VM, direct CIL and Rust
native/Wasm execution are not qualified by this host metadata API. #2475 remains
open for its broader reflection requirements.

New-API measurements at source `16dda1e4c5e68ebebfcd069eee3eb868bdd41057` ran
serially on the shared Apple M3 Pro, darwin-arm64 host with Node 24.21.0 and a
1 GiB heap cap. A cold operation creates the 18 MethodDesc identities and their
displays after loading the module: median 118.875 µs, p95 251.875 µs, p99
3,177.792 µs. A cached `Constructed.toString()` query measured median 0.003350 µs,
p95 0.015142 µs and p99 0.019850 µs. Each distribution contains 100 samples;
the cached query uses 10,000 iterations per sample after 10 warmup samples.
[All 200 raw samples and exact source hashes](benchmarks/method-display-node24.json)
are retained. There is no prior equivalent implementation, before/after speed
claim or statistical significance claim. Allocations and retained display-string
footprint were not measured; existing descriptor reads add no display lookup.

The nested-argument extension reuses the bounded metadata full-name query.
Qualified nested names validate all ancestors through existing TypeDef identities
or raw TypeRef scopes, up to 64 nesting edges; reserved ancestor identifiers reject
instead of being confused with metadata nesting separators. Validated names are
cached only for the current format query. No referenced assembly, base/interface
graph or method body is loaded. Outermost simple nested names do not expose their
ancestors and keep their existing behavior. This extension's three authored tests
and eight-method native C# source are prepared, with capture, focused tests,
paired/new-capability measurements and checks pending the serial slot. The earlier
18-record/200-sample evidence above qualifies the initial display API only.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-display.mjs tests/fixtures/clr-method-display/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-display*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-display.mjs
```
