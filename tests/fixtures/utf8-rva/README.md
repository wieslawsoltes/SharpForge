# UTF-8 literal storage reference

This fixture qualifies SF-A02-T77 (#658): C# 11 UTF-8 literals use assembly data when the target's
`ReadOnlySpan<byte>(void*, int)` constructor is available. The stored bytes include one terminating
zero after the span's visible length. Empty literals still have one stored byte. Embedded zeros,
multibyte Unicode, raw literals and literal concatenations preserve their actual byte sequences.

The compiler collects distinct bound literal text before allocating metadata tokens. Source methods,
local functions, lambdas, field initializers, constructor initializer calls and iterator bodies share
the same preplanned fields. UTF-8 data follows the method bodies in the PE section. FieldRVA rows
point at the final field tokens; explicit byte storage structs have packing size 1. Reference
assemblies omit these body-only types and data.

## Genuine compiler and runtime capture

Run the generator only during a scheduled serial validation slot:

```sh
node scripts/limited.js node tests/fixtures/utf8-rva/build-fixture.mjs
```

`SHARPFORGE_ORACLE_DOTNET` selects the installed host. The shared `resolveToolchain` verifies the
exact SDK, Roslyn binary, runtime and reference pack in
`planning/qualification/oracle-toolchain.json`. `provenance.json` records their resolved versions,
hashes, local environment, input hashes, compiler options and every controlled reference projection.
The generator never invokes SharpForge to produce expected output. It writes the new capture only
after every native probe succeeds.

`Utf8Literals.dll` is the pinned Roslyn implementation. `modern.out` is its actual CLR output from
the independently Roslyn-compiled `InspectUtf8.cs` consumer. The consumer inspects exact bytes and
the terminal zero, duplicate-data identity, a saved span after full collection, nested lowering and
allocated bytes across 10,000 literal calls. The allocation loop is compiled by Roslyn with
`NoOptimization | NoInlining` so calls remain present even when the compiler under comparison does
not emit `MethodImpl` attributes. This probe measures allocation count, not runtime throughput.

## Required and optional target members

The `ReadOnlySpan<T>(T[], int, int)` constructor is a required compiler member. Roslyn checks it
before optimizing away the temporary array. The pointer constructor is optional. The native probes
make exactly one of these constructors inaccessible in a temporary copy of the actual
`System.Runtime.dll` reference, changing only its MethodDef access bits. The installed reference pack
is never edited. These are controlled target-contract projections, not claims about a historical SDK.

The optional-constructor projection must compile and run with an allocated byte array, including
its terminal zero and an explicit visible length. `fallback.out` pins that real result. The required
constructor projection must report the genuine `CS0656` diagnostic recorded in
`missing-constructor.json`; reference-only emission does not lower the body and still succeeds.

The focused reference tests compile against those same projected bytes. The native regression test
runs new SharpForge assemblies in registry, actual-reference and fallback modes against the captured
consumer output. The bytecode APIs (`compile` and `compileToIL`) retain their explicit unsupported
span diagnostic; this fixture does not report them as executable UTF-8 implementations.

## Primary sources

- [C# 11 UTF-8 string literals proposal](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-11.0/utf8-string-literals.md)
  specifies UTF-8 bytes, the `ReadOnlySpan<byte>` result, concatenation and the terminal zero.
- [Roslyn `LocalRewriter_Conversion.cs`](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Lowering/LocalRewriter/LocalRewriter_Conversion.cs),
  observed Git blob `58a74e5906492d23363ad21bf4ea219062c7826a`, implements `VisitUtf8String` and
  `MakeUtf8Span` with the required array/start/length constructor and appended zero.
- [Roslyn `EmitArrayInitializer.cs`](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/CodeGen/EmitArrayInitializer.cs),
  observed Git blob `4379774eab8aa1aaaffe7884336cdf62b87c9312`, implements
  `TryEmitOptimizedReadonlySpanCreation`: the byte case uses FieldRVA storage, `ldsflda`, the visible
  length and the optional pointer constructor, and retains array lowering when that helper is absent.

These source blobs describe the lowering design. The captured compiler identity is recorded
separately from the source snapshot; no equality between their revisions is assumed.
