# Dynamic call sites in direct .NET assemblies

`compileToAssembly` emits C# dynamic operations through the real .NET
`Microsoft.CSharp.RuntimeBinder` and `CallSite<T>` APIs. Supply a reference set
that includes the runtime binder and `System.Linq.Expressions`, such as the
installed .NET reference pack:

```js
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

const pack = loadReferencePack();
if (!pack) throw new Error('Install a .NET SDK and set DOTNET_ROOT');

const result = compileToAssembly(`
  class Program {
    static void Main() {
      dynamic text = "SharpForge";
      int length = text.Length;
      System.Console.WriteLine(length);
    }
  }
`, { name: 'Program', references: pack.references });
```

The compiler retains each argument's static type, constant status, name, and
reference kind. The runtime binder chooses the operation using that information
and the runtime types of dynamic operands. Call sites are cached in static fields
of synthesized nested types; generic scopes get separate caches for each closed
instantiation. Signatures use `Func`/`Action` where possible and synthesized
runtime delegates for `ref`/`out` or larger signatures.

## Qualified operations

The two reference fixtures exercise the following behavior on real .NET:

| Area | Covered behavior |
| --- | --- |
| Invocation | Dynamic receivers and delegates; static and instance method groups; named, optional, and explicit generic arguments; discarded void calls and invalid void results |
| Generic scopes | Generic methods, generic local functions, generic containing types, and captured lambdas; custom delegates containing generic reference parameters |
| Construction | Runtime constructor selection, object and index initializers, collection initializers |
| Members and indexes | Get/set, compound assignment, increment, null-coalescing assignment, conditional access, receiver/index evaluation once |
| Events | Runtime event detection and add/remove accessors, including a delegate-valued property using the same source syntax |
| Operators | Arithmetic, comparison, bitwise and shift operators, unary operators, short-circuit logic and user-defined truth operators |
| Conversions | Implicit/explicit conversions, checked overflow, typed compound-assignment results, and dynamic array dimensions/indexes |
| Control flow | Dynamic enumeration with typed iteration variables; synchronous/asynchronous disposal; disposal after a later acquisition fails |
| Await | Completed and pending tasks, a pending outer operand, ordinary and critical custom awaiters, and discarded void results |

Receiver storage follows the captured Roslyn behavior. A dynamically dispatched
method on a writable struct can mutate its original storage. A simple dynamic
index assignment also retains writable storage. Compound dynamic indexer
lowering captures a struct receiver value, so a setter on that captured copy
does not change the original variable. The reference fixture includes a getter
with observable mutation to distinguish these paths. A dynamic setter's returned
value retains conversions such as narrowing an `int` operator result into a
`byte` property.

The await path reuses the compiler's existing state machines, builders, pending
operand storage, exception regions, and debug suspension markers. The compiler
does not add an interpreter or JavaScript code evaluation for late binding.

## Diagnostics and target limits

Missing or incompatible required runtime helpers produce CS0656 and no assembly.
Helper lookup checks the declared signatures and accessibility, not only member
names. Merely declaring or assigning `dynamic` still uses object signatures and
does not require call sites. Ordinary programs introduce no dynamic caches or
new runtime-binder assembly dependency.

The focused tests retain restrictions on lambda arguments and ref-like receivers,
and reject dynamic unsigned right shift with CS0019. Existing binder restrictions
on explicit `in` arguments, method groups, `base` dispatch, and expression trees
remain in force.

This qualification covers the direct .NET backend. Source-image compilation and
the browser/image runtime still report SF2200 for dynamic operations because
those targets do not provide the .NET runtime binder. Async enumeration of a
dynamic collection remains outside the direct emitter's supported foreach forms.
The batch does not establish complete Roslyn diagnostic parity for COM interop,
expanded non-array `params` collections, local-function inference involving
dynamic arguments, or every invalid logical-operand combination.

## Reference evidence

The checked-in `dynamic-callsites.out` and `dynamic-control-flow.out` were captured
from Roslyn programs and then matched by the SharpForge assemblies on the same
.NET host. They contain 89 and 25 output lines respectively. The capture used
.NET SDK **10.0.201** and reference pack **10.0.5**; compiler/source/output hashes
are recorded in
`packages/compiler/test/cil-emission/reference-fixtures/dynamic-runtime.provenance.json`.

Run captures and tests serially through the repository resource wrapper:

```sh
node scripts/limited.js node packages/compiler/test/cil-emission/verify-dotnet.mjs --references --only dynamic-callsites --update
node scripts/limited.js node packages/compiler/test/cil-emission/verify-dotnet.mjs --references --only dynamic-control-flow --update
node scripts/limited.js node --test tests/compiler-cil-dynamic-callsites.test.js tests/compiler-cil-emission-dynamic.test.js tests/compiler-binder-dynamic.test.js
```

Set `DOTNET_ROOT`, `DOTNET`, and `PATH` to the selected SDK installation. The
three focused files have **30 passing tests and no skips** in this qualification.
The first full run revealed the struct receiver-copy mismatch described above;
its fix was checked against the genuine Roslyn output. Two new metadata tests
also needed their type-name lookup corrected to account for nested full names;
the entire 13-test callsite file passed after that correction. Both existing
dynamic test files passed in the initial run.

No performance benchmark was run in this batch. The absence of new dynamic
metadata in an ordinary program is tested; it is not a timing or allocation
measurement.
