# Compiled binding descriptor version 1

`compileBindingDescriptor` resolves a bounded expression against an injected metadata
symbol table. `CompiledBindings` executes the resulting descriptor by member token.
Evaluation does not parse a string property path, call `eval`, generate JavaScript or
fall back to reflective Binding when a token cannot be resolved.

The executable data schema is
`src/binding/compiled/descriptor.schema.json`. Its runtime validator is
`validateCompiledBindingDescriptor`. Both use format version `1`; stable token and source
identities are supplied by the owning assembly/application.

## Descriptor shape

This illustrative descriptor transfers one metadata property. Token numbers are examples;
an application must use tokens from its actual emitted or inspected assembly.

```json
{
  "version": 1,
  "kind": "property",
  "mode": "OneWay",
  "target": {"id": "title", "token": 385875969},
  "expression": {
    "kind": "path",
    "steps": [{"token": 385875970, "nullConditional": true}]
  }
}
```

`kind` is `property`, `event` or `load`. Property/event targets contain an application
target id and metadata token. A load target contains an id and the deferred element name.
`mode` defaults to OneTime; OneWay and TwoWay add tracking and writeback. Optional
`sourceType` and `targetType` fields contain metadata type tokens. `phase` is an integer
from zero through 1,024.

Expression forms are deliberately small:

| Form | Fields and behavior |
| --- | --- |
| `constant` | A finite scalar or null `value`. |
| `context` | A declared contextual `name`, such as value, sender or eventArgs. |
| `path` | Optional root expression; typed token steps with optional index argument expressions. |
| `cast` | A metadata type token and child value expression. |
| `call` | A method token, optional receiver, argument expressions and null-conditional flag. |

Property paths contain metadata tokens instead of member-name strings. Context names,
target ids and deferred names are structural identifiers, not reflective member lookups.
The validator accepts only known fields, supported token families and plain data objects.
It rejects functions, accessors, cycles, prototype objects, invalid token values and
unbounded graphs before invoking any application code. The default graph limits are
4,096 nodes, depth 32, 128 path steps, 32 call arguments and bounded strings.

`converter`, `convertBack` and `bindBack` are token expressions. Converter instances,
parameters, language and type values are injected as controller context values; managed
references are not serialized into the descriptor JSON.

## Expression compilation and metadata contracts

`parseCompiledBindingExpression` parses members, indexers, method calls, constants,
parentheses, casts and null-conditional access. `compileBindingExpression` returns the
typed token expression. `compileBindingDescriptor` also validates event signatures,
Boolean load expressions, return types, method arity and source writability for TwoWay.

The symbol service resolves `type`, `member` and `method` against real metadata. A member
record supplies a token, result type and readable/writable flags. A method supplies its
token, staticness, parameter types and return type. Ambiguous overloads, missing tokens,
unsupported syntax and invalid signatures produce `CompiledBindingCompileError`:

| Code | Meaning |
| --- | --- |
| `SFXB001` | Invalid descriptor/schema. |
| `SFXB002` | Unsupported or malformed expression syntax. |
| `SFXB003` | Required typed member metadata is unavailable. |
| `SFXB004` | Invalid type, cast, load expression or binding-kind result. |
| `SFXB005` | Invalid method, event signature or argument list. |
| `SFXB006` | TwoWay source is not writable. |

The managed adapter indexes source-image and CIL metadata once per application.
Source/canonical execution accepts the emitted `bindingAssembly`; direct CIL execution
uses its inspector. Framework/UI accessors resolve real MemberRef signatures, preserving
their declared owner and parameter/return types. Managed getters, setters, fields,
interface implementations and calls use the VM's bounded synchronous invocation seam.
The runtime never compiles arbitrary source text to recover absent metadata.

Dynamic XAML passes the root/code-behind, target, NameScope, schema member and phase into
`context.compileBinding`. The writer runs the resulting lifetime after the graph and its
names are complete. Each template instance owns an independent initialization list and
controller. JavaScript hosts may inject the same authoritative symbol/compiler service;
a host without it reports an explicit unsupported XAML diagnostic.

## Controller and notification lifecycle

Create a controller with `new CompiledBindings({descriptors, source, target, services})`.
`source()` supplies the data/code-behind root and `target(id)` resolves an existing target.
The required token access service includes `get`; property writes use `targetSet` and
TwoWay adds `targetSubscribe` plus `set` or a BindBack invocation. `subscribe`,
`subscribeEvent`, `invoke` and `isType` are injected for the relevant expression forms.
Hosts that coerce target values supply `targetGet` to read the effective result; a source
getter is never called on a target merely to track a write echo.

`Initialize()` evaluates and starts tracking once. `Update()` explicitly re-evaluates
even after `StopTracking()`, without recreating subscriptions while tracking is stopped.
`StopTracking()` removes source, target and event subscriptions and cancels phase work.
`Dispose()` releases controllers and their retained context values. Each path receiver and
function argument is tracked independently; replaced intermediate objects are detached.
Queued echoes of the controller's own target writes are suppressed before BindBack.

Function expressions re-evaluate when an observed argument changes. Event expressions
invoke either a zero-argument method or the approved `(sender, eventArgs)` signature.
TwoWay BindBack receives the target value, and optional ConvertBack runs first.
Source and target callbacks use weak tracker closures. Reachable target-owner models
explicitly report the managed values they retain; merely retaining a source event does
not make a removed target a GC root.

Snapshots save resolved dependencies, observer state, transferred values and pending phase
entries. Coordinated restore reinstates these records without calling getters, converters,
event handlers or factories. Controllers created after the checkpoint are disposed under
restore suppression. Snapshot data is scoped to the current application and heap.

## Deferred elements and phases

`DeferredElementScope` owns named factories and their active instances. With `x:Load=false`
the writer reserves the name and insertion position before constructing the child. Neither
the child nor its scene node exists until `FindName` or a true load value realizes it.
Unloading detaches the instance and disposes its names, observers and template lifetime.
Later realization calls the factory again and requires a fresh instance.

`DeferredXamlElement` connects that model to the writer's instantiate/attach/detach service.
`NameScope.peekName` observes without realization; `findName` may realize a reserved name.
Load on an unsupported root/resource position is rejected explicitly. Restore uses saved
instances and factories without running an activation or teardown sequence.

`BindingPhaseScheduler` uses injected request/cancel-frame callbacks, ascending phase
order, bounded pending work and bounded work per frame. Recycling or StopTracking cancels
pending work. Restored work receives a new scheduling generation, so stale callbacks cannot
execute a discarded batch. A synchronous request-frame provider is rejected. The items
generator consumes these lifetimes through ContainerContentChanging phase hooks.

## Deliberate profile limits and qualification

This is the bounded token-expression profile above, not the full C# expression language.
Unapproved operators, reflection, dynamic member discovery, missing metadata and ambiguous
overloads are diagnosed. Managed arrays have general Binding index support; a compiled
array index needs a real approved accessor token and is rejected when none exists. General
Binding literal conversion and explicit compiled converter expressions remain distinct;
an incompatible compiled result faults at the typed target store.

The authored managed fixtures cover source VM, canonical-image VM, direct CIL and
reassembled CIL. Portable JavaScript descriptor fixtures exercise the same compiler and
executor. Native CLR/WinUI, Rust/Wasm UI execution, browser visual output and performance
are separate qualification targets; they are not reported as passed by these tests.
See [property-acceptance.md](property-acceptance.md) for exact evidence and outstanding gates.
