# C# 15 preview unions

SharpForge binds unions according to
[`unions.md` at csharplang commit 412dc3023500b69f684c365762e38db6ee7564ea](https://github.com/dotnet/csharplang/blob/412dc3023500b69f684c365762e38db6ee7564ea/proposals/csharp-15.0/unions.md),
SharpForge proposal revision 1. Use `langVersion: 'preview'`. Stable language versions reject union declarations
with `CS8652`. The pinned Roslyn compiler does not parse union declarations, so the fixtures for this feature are
proposal tests and ordinary-C# lowering comparisons.

## Contracts and declarations

A union declaration creates an ordinary struct with one readonly object field, a public `object? Value` getter,
and one public constructor for each declared case. Its generated members implement the actual
`System.Runtime.CompilerServices.IUnion` interface, and the type receives the actual `UnionAttribute` attribute.
Supply both types in source or references. The compiler reports `CS0518` when either is absent and does not
invent a replacement contract.

For example, a program can supply the contracts explicitly:

```csharp
using System;
#nullable enable

namespace System.Runtime.CompilerServices
{
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, AllowMultiple = false)]
    public sealed class UnionAttribute : Attribute { }
    public interface IUnion { object? Value { get; } }
}

union NumberOrText(int, string?);

class Program
{
    static void Main()
    {
        NumberOrText first = 42;
        NumberOrText copy = first;
        first = "changed";
        Console.WriteLine(copy is int value && value == 42);
        Console.WriteLine(default(NumberOrText) is null);
    }
}
```

Case types must convert to `object`; ref-like values, pointers and `void` do not qualify. Case declarations must
produce distinct constructor signatures. Cases may include generic parameters, nullable value types and other
unions. A nullable creation parameter keeps its nullable constructor signature but contributes its underlying
type to the case set, following the proposal's resolved nullable-case question.

A union declaration can contain methods and static state. It cannot declare instance fields, auto-properties
or field-like events, or replace the generated `Value` member. Explicit public one-parameter constructors are
forbidden. Other constructors must delegate through `this(...)` to a generated case constructor.

## Custom unions and providers

A class or struct carrying the actual `UnionAttribute` can supply its own storage and union APIs. Its public
one-parameter constructors establish its cases, and its public `object` or `object?` Value getter exposes its
contents. Creation parameters may be passed by value or `in`.

A directly nested public `IUnionMembers` interface can provide the APIs instead. The union must implement that
interface; its static one-parameter `Create` methods return the union type, and its Value property supplies the
getter. A provider interface on a struct uses constrained interface dispatch in emitted CIL.

Direct public getter-only `HasValue` and applicable `TryGetValue(out T)` members provide the proposal's optional
access path. Pattern emission caches their results across alternatives of the same switch. It prefers an
applicable `TryGetValue` that avoids boxing. Obsolete, experimental and otherwise unusable optional APIs are
ignored as specified by the resolved question about bad optimization members. A basic Value getter returning
by reference is dereferenced when its value is matched.

## Conversions and patterns

A standard implicit conversion to a creation parameter can feed a union conversion. Normal overload resolution
selects the creation member and respects the accessibility of additional constructors. An ambiguous selection,
or an accessible winning member that is not a union creation member, is diagnosed. Applicable user-defined
conversion operators retain priority, including explicit operators used by casts. A union conversion is not a
standard conversion and cannot chain through another union or user-defined conversion.

Type, declaration, typed recursive, non-null constant and relational patterns match the union's contents. A
null pattern succeeds for either a null union reference/nullable wrapper or null contents. `var`, discard,
list and untyped property/positional patterns retain the union instance. In an `and` pattern, the right side
receives the left side's output value; `or` and `not` retain the original value source. An `or` pattern can still
narrow a nullable wrapper when both branches narrow that same source.

Case types feed the existing pattern-space algebra for exhaustiveness and unreachable-arm diagnostics.
Switch statements, including constant labels and `goto case`, use the same union pattern behavior. Direct
Value property patterns use ordinary property matching where their result does not require an unresolved
special union rule.

Nullable analysis tracks Value's declared annotation, the input null-state of creation, copies and assignments,
successful type/null/optional-access tests, and flow between switch arms and sections. It reports `CS8655` for
unhandled null contents or an unhandled null wrapper/reference in an enabled nullable context.

## Explicit proposal and runtime boundaries

`SF2202` remains for these unresolved questions in the pinned proposal:

- Custom unions missing the mandatory basic creation or Value APIs, in “custom union declarations ... missing
  the minimal set of APIs.”
- Case compatibility or exhaustiveness that needs special treatment of direct Value property patterns, in
  “Should direct Value property matching follow Union rules?”
- Precise inherited, hidden or read/write optional access-member lookup, in the non-boxing member lookup question.
- Nullable flow for a queried `TryGetValue` whose out type is not a case type, in “TryGetValue and nullable analysis.”

Specified declaration/API violations use `SF2203` or the applicable existing C# diagnostic; they are not described
as unresolved proposal questions.

| Execution path | Current result |
| --- | --- |
| Direct CIL emitted by `compileToAssembly`, run on pinned CoreCLR | Focused proposal programs and lowering comparison pass. |
| SharpForge CIL VM | Managed-reference fields and generic aggregate owners are explicitly rejected by its existing struct profile. |
| Source bytecode VM via `compile` | Source structs remain an explicit `SF2200` boundary. |
| Browser / CoreCLR Wasm | No qualification is claimed by this batch. |

The runtime limitations mean the issue's requirement to execute the examples on both SharpForge backends is
still pending. The compiler emits real value types; it does not substitute class storage for either VM.

## Validation

The retained evidence is under
[`tests/fixtures/compiler-unions`](../../tests/fixtures/compiler-unions/README.md). The final focused run contains
62 passing tests and zero skips, including adjacent record, pattern, nullable-loop and semantic-model checks.
The native capture verifies SDK 10.0.201, CoreCLR 10.0.5, compiler and reference-pack hashes, then compares the
actual output of emitted unions with an explicit ordinary-C# implementation of the pinned lowering. Both
programs produce ten `True` lines with exit code 0 and no stderr. This is a lowering comparison, not Roslyn
union-parser parity.
