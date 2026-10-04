# StringBuilder value and array insertion reference

Capture with SDK 10.0.201 and runtime 10.0.5 from this directory:

```sh
dotnet run --project StringBuilderInsertValues.csproj --configuration Release -- ../string-builder-insert-values-net10.json
```

The program calls the exact native non-span Insert overloads for every integral
width, Single, Double, Decimal, Object, String, Char[] and Char[] ranges. It
records UTF-16 text, identity, exception type and parameter, native capacity and
chunk evidence, and observable object ToString calls. Inputs include numeric
extrema and exact floating bits, boxed primitives, null/empty values, isolated
surrogates, array block boundaries, invalid ranges, null receivers, and ToString
callbacks that return null, throw, append or clear the receiving builder.

All successful insertions are bounded to 4096 input UTF-16 units. Int32 extrema
are used only as indices or rejected array ranges. The result pins this source
with SHA-256. Only the serial validation owner captures or executes this corpus;
no expected native results are handwritten.

The retained root capture contains 546 rows plus a fluent evaluation-order
control, executed on Linux x64 using the pinned toolchain. Source SHA-256 is
`bf7c78f85a0118094da0fd3cf7430207e6ba3f5b554bfa4b7725c031e24f7578`.
The overload and validation paths also match the versioned
[.NET 10.0.5 StringBuilder source](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Text/StringBuilder.cs)
(blob `a159895c0ed7219995bcece0b45b553bc64e50ed`).

The remaining ReadOnlySpan<Char> overload requires the separate span execution
profile and is intentionally absent from this non-span corpus.
