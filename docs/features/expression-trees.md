# Expression trees

A lambda converted to `System.Linq.Expressions.Expression<TDelegate>` becomes
a tree of calls to the .NET expression factories. `compileToAssembly` emits
those calls into a normal managed assembly. The created tree can be inspected,
visited, and compiled by `Expression<TDelegate>.Compile()` on .NET.

```csharp
using System;
using System.Linq.Expressions;

class Program
{
    static void Main()
    {
        Expression<Func<int?, int?, int?>> sum = (a, b) => checked(a + b);
        Console.WriteLine(sum);                 // (a, b) => (a + b)
        Console.WriteLine(sum.Compile()(3, 4)); // 7
        Console.WriteLine(sum.Compile()(3, null) == null); // True
    }
}
```

## Factory lowering

Parameters are created once per lambda, and uses within the body share those
same parameter objects. Nested lambdas retain the identity of captured outer
parameters. A variable captured from an enclosing method is accessed through
the existing closure-cell field; a tree holds the cell object as a constant.

Arithmetic, comparisons, Boolean operations, checked numeric conversions, and
lifted nullable operators use the corresponding expression factories. A
user-defined operator supplies its selected `MethodInfo`, including a checked
operator where overload resolution selected it. Conditional logical operators
use `AndAlso` and `OrElse` with the selected bitwise method, preserving the
user-defined truth tests and short-circuit behavior. Enum operations promote
their operands to the required underlying integer representation and convert
the result back when required.

Nullable and user-defined conversions retain the standard conversions before
and after an operator. A user-defined conversion on the left of `??` is supplied
as a separate conversion lambda. That lambda uses its own parameter object and
the nongeneric `Expression.Lambda` overload. The two branches of a conditional
retain conversions needed to give them exactly the same result type.

Object construction supports assignments, collection initializers, nested
member initializers, and nested collection initializers. Empty initializers
remain represented. Anonymous objects name their constructor and getter
members, including members of constructed generic anonymous types. Rectangular
array allocation and element access are supported; wide numeric array indices
are checked before conversion to `int`. Rectangular array initializers are a
language restriction described below.

A method group inside a tree uses Roslyn's representation: a constant containing
the selected `MethodInfo`, a call to `MethodInfo.CreateDelegate`, and a conversion
to the delegate type. This covers static, virtual instance, generic, and reduced
extension methods. Value-type targets are boxed. Explicit delegate construction
from another delegate uses its `Invoke` method. Delegate combination, removal,
and equality name the `System.Delegate` methods and preserve the resulting type.

`typeof` values, default values, and field-like event reads also have factory
representations. A default struct or type parameter is boxed as a typed
constant. Calls may pass an existing variable or field through `ref`, `out`, or
`in`; this is separate from the restriction on a lambda's own parameters.

Reflection handles for members of constructed generic types include the
declaring type handle. The metadata-backed compilation path resolves framework
methods from the reference assemblies. The registry path retains symbolic
framework signatures for emission.

## Language restrictions

The target must be the actual `Expression<TDelegate>` type with a concrete
delegate argument. A user class merely named `Expression<T>` does not become an
expression-tree target. Invalid delegate arguments receive CS0835 before the
anonymous-method conversion check; an anonymous method assigned to a valid
expression-tree target receives CS1946.

The diagnostic fixtures pin these additional cases:

| Construct | Diagnostic and location |
| --- | --- |
| Anonymous object in an attribute argument or const field initializer | CS0836 on `new` |
| Bare method group or lambda as an `is` or `as` operand | CS0837 on the whole expression |
| Rectangular array initializer, including an empty initializer | CS0838 on array creation |
| `ref`, `out`, or `in` lambda parameter in a tree | CS1951 on the parameter identifier |
| Ref-returning call or property read | CS8153 on the member use |
| Reference to a local function, including a method-group conversion | CS8110 on the reference |

Anonymous objects remain valid in ordinary member initializers and tree bodies.
Explicitly converted delegate values remain valid operands of `is` and `as`.
Rectangular array allocation without an initializer, rectangular element access,
and jagged array initialization remain valid.

The existing checks continue to reject assignments, statement-bodied and async
lambdas, null-conditional operations, pattern and switch expressions, throw
expressions, tuple literals, index initializers, and inline-array operations.
The C# 14 optional/named-argument rules remain in effect.

The lambda-attribute integration reports CS8972 from successfully bound method,
return, or parameter attributes. A lambda attribute takes the whole lambda's
location; otherwise the first attributed parameter supplies the location. This
hook depends on the lambda-attribute binder and its separate qualification.

Implicit preview union conversions in a tree remain an explicit SF2202
boundary. The pinned union proposal does not establish an accepting rule, and
the referenced Roslyn diagnostics pass rejects such conversions. An explicit
constructor or factory call remains an ordinary tree expression. Union tests
qualify this boundary when the preview binder is integrated.

## Execution boundaries

The source-image runtime and its CIL VM do not provide `System.Linq.Expressions`.
A valid program requiring those factories receives the explicit unsupported
runtime diagnostic and no executable image. Native .NET execution through
`compileToAssembly` is qualified separately.

An unimplemented compiler tree form still receives SF2200. Nonconstant
interpolated-string tree lowering is a separate follow-up. No VM support or
performance gain is claimed by this compiler batch.

## Recorded validation

The new differential captures were produced with .NET SDK **10.0.201**, reference
pack **10.0.5**, and Roslyn **5.3.0.0**, informational version
`5.3.0-2.26153.122+4d3023de605a78ba3e59e50c657eed70f125c68a`.
The four `expression-tree-creation`, `expression-tree-operators`,
`expression-tree-delegates`, and `expression-tree-restrictions` pin files were
created by the real Roslyn pinning tool; expected results were not handwritten.

Eight output programs passed native reference-assembly comparisons. Together
they print **55 tree instances**, including `ToString()` and an
`ExpressionVisitor` node walk, and execute compiled delegates. The executed
checks include null propagation, checked overflow, user-defined short circuits,
conversion lambdas, aliasing through `ref` and `out`, virtual dispatch, generic
storage, nested initializer results, and runtime array bounds behavior.

Five diagnostic programs contain **19 diagnostics**. Both the registry and
reference-assembly semantic paths match the captured code, source span, and
severity. The focused diagnostic suite passed **20/20 tests with no skips**.
It parses through `SyntaxTree.parseText`, whose diagnostics describe C# syntax;
the legacy AST adapter's separate runtime-profile messages are not part of this
language comparison. The source-image failure test remains in the existing
expression-tree suite.

The initial combined run also passed all eight new factory-description checks,
the existing **40** expression-tree shape comparisons, and the existing CIL
factory/handle tests. Its only failing assertions were in the diagnostic harness,
which had included the legacy profile messages. The corrected diagnostic suite
was rerun on its own and passed; no compiler changes were needed after the first
native execution.

```sh
node scripts/limited.js node packages/compiler/test/differential/tools/pin.mjs --changed --list
node scripts/limited.js node --test tests/compiler-expression-tree-native.test.js tests/compiler-expression-tree-restrictions.test.js
node scripts/limited.js node --test tests/compiler-expression-trees.test.js tests/compiler-cil-emission-expression-trees.test.js
```

Set `DOTNET_ROOT` and `DOTNET` to the SDK location when it is outside the standard
installation paths. Native tests skip explicitly when the SDK or reference pack
is unavailable; the recorded native run had no skips.

Tracking: [SF-A02-T07.5](https://github.com/wieslawsoltes/SharpForge/issues/1319).
The factory shapes and restrictions also follow the primary Roslyn sources at
commit `8d2c75f24c88ea99a01a8579ecb67e303d566670`:
`ExpressionLambdaRewriter.cs` in `Lowering/ClosureConversion`,
`DiagnosticsPass_ExpressionTrees.cs`, and `LocalRewriter_BinaryOperator.cs` in
`Lowering/LocalRewriter`. The runtime factory overloads were checked against
`System.Linq.Expressions` source and then exercised by the native comparisons.
