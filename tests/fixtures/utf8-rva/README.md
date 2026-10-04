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
`missing-constructor.json`; the associated `.locations.json` file records actual SARIF ranges.
Repeated equal literal sites retain separate diagnostics while data storage remains deduplicated.
Reference-only emission does not lower the body and still succeeds.

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

## Correctness qualification on 2026-10-04

The exact pre-change revision was `bf85020e6024cdd679a0234d9f050ca7dedddf53`.
A temporary 8.4 MB sparse checkout contained that revision's compiler and all ten transitive package
sources, with workspace aliases pointing only into that checkout. The first instruction test failed
there with `newarr` and repeated `stelem.i1`, as retained in `validation/utf8-prefixed-baseline.log`.
The temporary checkout was removed after that check. The candidate started from isolated
`1a04c4f1dc644f574f8f20c7510f352a0230fd7d`; no newer integration branch was merged.

The final focused command passed **12/12 tests, zero skips**:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/compiler-cil-utf8-rva.test.js \
  tests/compiler-cil-utf8-rva-reference.test.js \
  tests/compiler-cil-utf8-rva-native.test.js
```

The native test executes three newly emitted SharpForge assemblies: closed-registry symbols,
actual .NET reference assemblies, and the controlled missing-optional-constructor reference.
All byte sequences, terminal zeros, duplicate identity, generic calls, local functions, initializers,
constructor initializer calls, stackalloc operands, iterators, and saved spans after collection match
the genuinely captured Roslyn consumer output. The source-only span and stackalloc adjacent suites
also passed **13/13 tests, zero skips**:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/compiler-stackalloc.test.js tests/compiler-first-class-spans.test.js
```

| Literal lowering | SharpForge bytes allocated / 10,000 calls | Roslyn bytes allocated / 10,000 calls |
|---|---:|---:|
| Registry static data | 0 | 0 |
| Actual-reference static data | 0 | 0 |
| Optional-constructor fallback | 400,000 | 1,120,000 |

These are recorded allocation observations from the exact native fixture, not a throughput benchmark.
The fallback uses different valid array initialization strategies, so its allocation-byte count is not
a language-semantic equality requirement. The test compares every functional output line exactly,
requires positive allocation for the fallback, and requires exactly zero for both static-data modes.
The initially incorrect allocation-equality assertion and both raw counts are preserved in
`validation/utf8-third-focused.log`; no expected output was manufactured or overwritten by SharpForge.

The first runs also found and retained these failures:

- Fixture oracle imports traversed one directory too far; the corrected paths use the shared pinned toolchain utilities.
- An unnecessary `MethodImplAttribute` on the library fixture was outside the closed registry's declared surface.
  It was removed from the library source and the genuine oracle was recaptured. The independently compiled
  consumer still has `NoInlining | NoOptimization` around its measured loop, so every literal call remains.
- Missing constructors used a source display name and reported only one repeated site. Emission now uses
  `System.ReadOnlySpan` followed by its metadata arity and preserves each actual source location. SARIF ranges match.
- The registry's readonly span indexer omitted its required `InAttribute` return modifier. That registry-only
  declaration now uses the existing imported-modifier signature encoding; real imported/source members retain their shapes.

The shared change outside literal modules is the small `compile-assembly.js` diagnostic-location seam:
a nonempty list produces one diagnostic per location, while an empty or absent list retains the original error.
Initial failures, the genuine final capture, and successful focused/adjacent logs are in `validation/`.
The implementation author confirms the qualified correctness scope above. Compiler throughput, p95,
and output-size comparison remain **pending a separately scheduled benchmark**; no performance pass
or speedup is claimed here. Bytecode remains explicitly unsupported with `SF2200`.
