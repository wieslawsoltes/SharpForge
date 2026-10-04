# Collection argument inference and overload selection

Collection expressions now contribute to both phases of generic method inference. This fixes calls such as
`JoinAll("~", [.. names, "z"])` when the method declares `params IEnumerable<T>`, including the normal form of
the params parameter. The inferred argument is `string` when `names` enumerates strings.

The same path handles nested collection targets, explicitly typed lambda parameters, inferred lambda results,
and method groups inside collection elements. Empty collections, `null`/`default` elements, incompatible bounds,
and an unconstrained target such as `M<T>(T)` cannot invent a type; the existing CS0411 diagnostic remains.

## Binding design

`binder/collection-expressions.js` supplies the target's collection shape and the iteration type of each spread.
Expression elements use the existing argument binder so method groups retain their output-inference callback.
`overload/collection-inference.js` flattens collection inputs once per generic candidate before the existing
two-phase algorithm runs. Spreads become typed lower-bound inputs; only expression elements can contribute
lambda or method-group output inferences. An explicit traversal stack avoids recursive calls through collection
nesting. Work and temporary storage are linear in the visited collection elements; calls without a collection
return through the existing inference path without constructing expanded argument arrays.

`overload/collection-betterness.js` handles collection conversions separately from natural-type conversions.
C# 12 compares collection categories and element-type convertibility. C# 13 additionally compares each element
expression, or a spread's iteration type, and preserves ambiguity for empty collections with distinct element
types and for conflicting element preferences. ReadOnlySpan is preferred to Span for identical element types,
and either span is preferred to an array or supported array interface with the same element type.

The typed `string[]` to `ReadOnlySpan<object>` versus `IEnumerable<object>` case already selected the span at
C# 14. The remaining stress-program ambiguity came from the collection expression argument to those overloads.
The new pinned cases distinguish both paths and preserve C# 13's ambiguity for the typed covariant array.

## Reference evidence

Rules follow the language design specifications:

- [C# 12 collection expressions: type inference and overload resolution](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-12.0/collection-expressions.md).
- [C# 13 better conversion from collection expression elements](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-13.0/collection-expressions-better-conversion.md).
- [C# 14 first-class span conversions](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-14.0/first-class-span-types.md).

Nine source fixtures live in `packages/compiler/test/differential/fixtures/collection-inference.js`. Their
hash-guarded pins in `pinned/collection-inference.json` were captured from Roslyn 5.3.0.0, informational version
`5.3.0-2.26153.122+4d3023de605a78ba3e59e50c657eed70f125c68a`, using SDK 10.0.201, runtime 10.0.5, and
Microsoft.NETCore.App.Ref 10.0.5. These pins include actual execution output, language versions, and diagnostic
codes with source offsets and lengths.

The implementation changed six initially failing focused tests into passing tests. The completed focused run
passed 12 tests: nine binding/selection tests, current-pin checks, exact error diagnostic/span comparisons with
real references for all nine fixtures, and execution of all five emitted output assemblies on actual .NET.
The adjacent collection-arguments, collection-target, params-collection and first-class-span test files passed
all 29 tests. Those existing tests also exercise the bytecode and image-derived CIL backends where supported.

```sh
node scripts/limited.js node --test tests/compiler-collection-inference.test.js tests/compiler-collection-inference-reference.test.js
node scripts/limited.js node --test tests/compiler-first-class-spans.test.js tests/compiler-params-collections.test.js tests/compiler-collection-arguments.test.js tests/compiler-collection-expression-targets.test.js
node scripts/limited.js node packages/compiler/test/differential/tools/pin.mjs --changed --list
```

Set `DOTNET_ROOT` and `DOTNET` to the installed SDK directory and host when they are not discovered automatically.
The reference test skips runtime execution on machines without a .NET installation and states the reason.

## Scope and qualification

This batch fixes the collection inference and collection overload-selection defects from
`stress-language/collection-expressions`. Inline-array operations in that full stress program are a separate
batch. It does not change collection construction/allocation strategy, collection-builder lowering, or runtime
storage. The image execution profile still reports its existing unsupported span targets explicitly. No native
or WebAssembly qualification is claimed here. Compile-time measurements are pending the shared serial benchmark
slot; no speedup is claimed.
