# Inline arrays

An inline array is a struct marked with
`System.Runtime.CompilerServices.InlineArrayAttribute`, with one instance field
and a positive element count. The field's type is the element type. The compiler
recognizes the same layout in source and imported assemblies, including generic
inline arrays whose element type is substituted at the use site.

The one-field rule counts emitted storage, including auto-property and field-like
event backing fields. A single writable backing field may serve as the element;
adding backing storage alongside an explicit field makes the layout invalid.

Explicit layout, record structs, and required, readonly, volatile, or fixed-size
element fields are rejected. Types or elements that cannot participate in the
generic span operations receive the unsupported-inline-array-language warning;
they are not assigned a span-compatible element shape.

```csharp
using System;
using System.Runtime.CompilerServices;

[InlineArray(4)]
public struct Quad
{
    private int _element0;
}

public static class Program
{
    public static void Main()
    {
        Quad values = default;
        for (int i = 0; i < 4; i++) values[i] = i + 1;
        values[^1] += 10;

        Span<int> view = values;
        Span<int> middle = values[1..^1];
        middle[0] = 20;

        foreach (ref int item in values) item++;
        Console.WriteLine(view[1]); // 21
    }
}
```

## Binding and safety

An element index may be implicitly convertible to `int`, `System.Index`, or
`System.Range`. Integer and from-end constant indices are checked against the
inline-array length during binding. A named argument in an inline-array access
is rejected. Stored `Index` and `Range` values are supported.

An integer or `Index` access denotes an element of the original storage. An
element of a readonly receiver is readonly. A value receiver can be read, but its
element cannot be used as a writable location or returned by reference.

Constant integer and `Index` operands are checked at compile time, including
explicit `Index` conversions and constructors. Literal range endpoints permit
the position immediately after the last element for empty slices, but reject
positions outside the buffer. Dynamic bounds and reversed ranges are checked
by the span operations at run time.

A range produces `Span<T>` over a writable receiver and `ReadOnlySpan<T>` over a
readonly receiver. Conversion to either span type requires a variable;
conversion to writable `Span<T>` also requires writable storage. An implicit or
explicit inline-array conversion preserves the exact element type: it does not
perform numeric conversion or reference-element covariance.

Views and references borrow the receiver's lifetime. Returning a view over a
local, escaping a value parameter's storage, or storing a shorter-lived view in
an outer span produces the existing ref-safety diagnostics. Views over an
appropriate `ref`/`in` parameter or heap field may be returned. `foreach` by value,
`ref`, and `ref readonly` follows the receiver's mutability and lifetime. Reference
iteration requires an original variable, even for `ref readonly`; an inline-array
temporary supports only iteration by value. Inline-array enumeration uses the
backing elements before any user-declared `GetEnumerator` or enumeration interface.

Inline-array accesses and conversions are rejected in expression trees. The
language operations require C# 12 or later. List patterns and using a collection
expression to construct an inline array are outside the shipped C# 12 feature.

## Direct CIL

`compileToAssembly` preserves `InlineArrayAttribute`; .NET supplies the expanded
struct layout and tracks reference elements. The emitter obtains the first
element through `Unsafe.As`, and builds borrowing spans with
`MemoryMarshal.CreateSpan` or `CreateReadOnlySpan`. Compile-time checked offsets
use `Unsafe.Add`; runtime indices use the span indexer. Slices use the existing
`Index.GetOffset` support and the span's checked `Slice` method.

No managed array is allocated for an inline-array view or access. A compound
assignment captures the managed element reference once, preserving the order
and single evaluation of the receiver and index. Rvalue receivers are copied
into a temporary before an element is read or an enumeration begins.

Source-image execution and the direct-CIL VM still have runtime storage and
framework-intrinsic prerequisites for these programs. This change implements
compiler binding and direct .NET assembly emission; it does not claim runtime
VM support or measured performance gains.

## Validation

Focused tests are in `tests/compiler-inline-arrays.test.js` and
`tests/compiler-cil-emission-inline-arrays.test.js`. They cover diagnostics,
readonly and escape rules, emitted metadata, single evaluation, runtime bounds,
generic managed elements, and the pre-existing Roslyn-pinned
`stress-language/collection-expressions` program. The latter integration case
also needs the collection-inference work in Project #5.

The focused suite passed all 23 cases with no skips using .NET SDK 10.0.201 and
reference pack 10.0.5. This includes real .NET execution of the aliasing, slicing,
generic managed-element, and bounds regression, plus the existing Roslyn-pinned
collection-expression stress program.

A separate live Roslyn 5.3.0.0 comparison checked 25 positive and negative
programs against both the registry and reference-assembly binding paths. All 50
comparisons matched the relevant diagnostic codes, source spans, and severities.
This confirmed the borrowed-variable diagnostic for assigning an inner local's
view to an outer span, and the attribute-name diagnostic on an inline record
struct. Native execution also matched Roslyn's output for custom-enumerator
precedence and generic auto-property backing storage.

The 20 existing Index/Range, source ref-safety, and C# 12 rule regression cases
also passed with no skips.

These checks did not create or refresh a Roslyn corpus pin. The optional
execution cases report the actual SDK and reference-pack versions and skip when
those tools are unavailable. Source-image profiles remain unsupported and are
checked for failure with no image and their explicit profile diagnostics.

```sh
node scripts/limited.js node --test tests/compiler-inline-arrays.test.js tests/compiler-cil-emission-inline-arrays.test.js
```

Specification: [C# 12 inline arrays](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-12.0/inline-arrays.md).
Tracking: [SF-A02-T80](https://github.com/wieslawsoltes/SharpForge/issues/661),
[SF-A02-T67](https://github.com/wieslawsoltes/SharpForge/issues/648), and the
runtime qualifications in [SF-A02-T66](https://github.com/wieslawsoltes/SharpForge/issues/647).
