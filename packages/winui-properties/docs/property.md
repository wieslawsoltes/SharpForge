# Property stores, notifications and bindings

Import the public API from `@sharpforge/winui-properties`. The package does not import the
compiler, managed runtime, framework registry or a browser. Each application supplies the
type and lifecycle services that it owns. The managed and JavaScript adapters compose the
same registry, effective-value store, binding expressions and resource services.

The runnable example is `packages/winui-properties/examples/property-binding.mjs`:

```sh
node packages/winui-properties/examples/property-binding.mjs
```

## Registry and metadata

`new DependencyPropertyRegistry(options)` creates an application-owned identity table.
`register({ownerType, name, propertyType, metadata, attached, readOnly})` and
`registerAttached(options)` return frozen tokens. `lookup(ownerType, name)` walks the
declaring base chain; inherited accessors return the same token. `resolve(token)` rejects
copies, forged identities and tokens from another application. Duplicate owner/name
registration throws `PropertyFault` with `kind: 'ArgumentException'` before changing state.

The registry accepts these injected services:

| Service | Purpose |
| --- | --- |
| `canonicalType(name)` | Normalize the host's type spelling. |
| `baseType(name)` | Resolve one base type; default assignability follows this chain. |
| `isAssignable(target, source)` | Add interface or other host type relationships. |
| `getDeclaredProperty(owner, name)` | Lazily import the declared framework property. |
| `typeDefinition(name)` | Describe enums, value types and their typed defaults. |
| `typeOf(value)` | Identify a native wrapper or managed reference's actual type. |
| `validate(property, value)` | Apply additional host validation without converting values. |

Owner and property type names are limited to 4,096 characters and property names to 512.
The default registry capacity is 100,000 properties, configurable from one to one million.
Base-type resolution is bounded to 256 steps and identities are positive safe integers.

`PropertyMetadata(defaultValue, changedCallback, options)` is immutable. Metadata supports
`createDefaultValueCallback`, `validateValueCallback`, `coerceValueCallback`, `inherits`,
`inheritanceKey`, numeric ranges, enum values and a default source-update trigger. The
factory runs lazily once for each owner/property. A recursive factory faults; a failing
factory does not publish a partially initialized entry. Managed callbacks are invoked
through the host's bounded invocation service.

Registration validates the default before publishing the token. Omitted scalar defaults
use CLR-style zero values; known value structs receive typed zero/default records.
`Nullable<T>` preserves `null` and accepts a non-null value only when its approved
underlying scalar, enum or value type validates. A nullable property does not replace
`null` with the default value of `T`.

`registerBuiltInAttachedProperties(registry, descriptors)` registers each declared attached
owner/name once, before ordinary lazy lookup. It merges the accessor and instance
descriptor metadata and returns indexes by contract and host property name. Grid, Canvas,
WrapPanel, typography and TextElement accessors use this path; attached values do not need
an independent `$` storage system.

## Effective values and host notifications

Create one `PropertyStore({registry, ownerType, owner, onChange, ...services})` per dependency
object. It keeps sparse source slots and evaluates them in this order:

| `ValueSource` | Numeric identity | Meaning |
| --- | ---: | --- |
| `Default` | 0 | Metadata or a host-seeded per-instance default. |
| `Inherited` | 1 | The effective value from the logical parent. |
| `DefaultStyle` | 2 | The control's default theme style. |
| `StyleSetter` | 3 | Explicit or implicit application style setters. |
| `VisualState` | 4 | Active visual-state setters. |
| `TemplatedParent` | 5 | TemplateBinding and template-parent values. |
| `Binding` | 6 | A general or compiled binding result. |
| `Local` | 7 | `SetValue` or an explicit local assignment. |
| `Animation` | 8 | An active animation value. |

`getValue(dp)` reads the effective value. `readLocalValue(dp)` returns the local slot or
the unique `UnsetValue`; a local `null` remains different from an absent local value.
`setValue` and `clearValue` modify only `Local`. Internal adapters use `setSource` and
`clearSource` for their own slots. `getBaseValue(dp)` reads beneath `Animation`, so stopping
an animation reveals the current base value even if a style or local value changed while
the animation was active.

Only effective value changes call `onChange`. Equal struct fields, equal managed handles,
equal scalar values and writes hidden by a higher source do not emit duplicate changes.
Brushes and other reference objects keep reference identity. `EffectiveValueEmitter`
indexes mutable value consumers and emits one property update for each affected consumer;
it does not scan the managed heap or reset the scene.

`validateValue(dp, value, {coerce})` preflights a candidate without changing slots or raising
property-change notifications. It deliberately invokes supplied validation/coercion
callbacks; those callbacks must satisfy their own purity contract. The same scalar,
enum, reference, nullable and range checks apply to local, style, binding and animation
writes. Failed validation leaves the previous value intact.

Public writes to a read-only property fault. A host may inject a private `readOnlyKey`
when constructing a store, then call `setReadOnlyValue(dp, value, key, source)` to publish
layout measurements or seed defaults. The capability is not exposed by WinUI `SetValue`.
JavaScript's internal `styles.initializeDefault` uses this path and preserves the exact
typed native rendering collection wrapper without creating a second facade collection.

`transaction(action)` rolls back property state on failure and coalesces changes until
commit. Scene hosts additionally journal objects, models and commands so a failed style
or template application rolls back the larger UI operation. `ChangeNotificationQueue`
delivers FIFO, coalesces pending changes by property identity and bounds reentrant work.

## Inheritance, callbacks and snapshots

`store.setParent(parentStore)` changes the logical inheritance parent, checks cycles and
invalidates inherited values. Released properties with separate identities may share an
explicit `inheritanceKey`, such as `FontSize`; explicit local values still override
inheritance. Controls and templates supply logical and physical parent relationships
through the shared object-tree service.

`registerPropertyChangedCallback(dp, callback)` returns an owner-scoped integer token;
`unregisterPropertyChangedCallback(dp, token)` removes that exact registration. The managed
ABI exposes the token as `long`. Ordinary `subscribe(dp, listener)` returns a disposer.
Tokens and delegate values are included in snapshots. Owner callbacks remain rooted only
while their managed owner is reachable; registry metadata lives with the application.

Registry, store, queue, observable and binding snapshots are in-memory session snapshots,
not a portable serialization format. Restore validates bounds and identities first,
removes post-checkpoint registrations, and preserves captured immutable property tokens.
The VM restores its heap/handles and native owner state together. Binding restore reinstates
saved subscriptions without evaluating source getters, converters, factories or target
transfers. Restoring only a native observer table cannot replace a coordinated heap rewind.

## Observable sources and collections

`ObservableObject` supplies `get`, `set`, `notify` and explicit property subscriptions.
An empty or null notification name invalidates every binding on the source. It never
rewrites the prototype or setters of an arbitrary JavaScript object.

`ObservableVector` and managed `ObservableCollection<T>` share versioned storage and exact
Add/Remove/Replace/Move/Reset notifications. Indexers validate bounds before writes.
Enumerators fail when the collection changes; vector views are immutable copies.
The WinUI vector/list adapters dispatch through the host's authoritative mutation service,
which owns rollback, item-source restrictions, visual ordering and scene deltas.

Collection notifications contain `action`, numeric `Action`, `NewItems`, `OldItems`,
`NewStartingIndex` and `OldStartingIndex`; the vector projection also exposes
`CollectionChange` and `Index`. Ordinary list changes do not become scene resets.
The registered generic ABI covers `object`, `string`, `int`, `double`, `bool` and UIElement
vector/list interfaces. ObservableCollection constructors cover the five scalar/object
profiles. Additional closed generic APIs require an explicit framework contribution.

Managed user lists with real `Count` and integer indexer methods are projected by
`context.bindingServices.collection(reference)`. Reads and writes invoke the actual
managed members, including explicit interface implementations. The projection adapts INCC,
keeps a weak source handle, and exposes its source through `retainedValues()` when retained
by a reachable ItemsSource owner. It does not copy managed list storage into a native array.
A notification whose position is explicitly unknown uses an authoritative Reset; a list
without notifications cannot report mutations performed outside the projection.

Managed arrays retain their real bounds and element types on indexed binding writes.
Capacity defaults are one million collection items and 100,000 observer listeners.
Loaded/Unloaded and owner collection detach binding subscriptions. Explicit listener
retention metadata is used for user delegates; internal observer closures do not root
otherwise unreachable targets.

## General bindings

`BindingOperations.SetBinding(store, dp, binding)` installs an expression and clears the
old local target value. Configuration accepts `Source`, `Path`, `ElementName`,
`RelativeSource`, `Mode`, `Converter`, `ConverterParameter`, `ConverterLanguage`,
`FallbackValue`, `TargetNullValue` and `UpdateSourceTrigger`.

Paths support members, integer/key indexers and attached properties. Each intermediate
receiver is observed independently; replacing one detaches its previous suffix. A path
is limited to 4,096 characters and 128 steps. A missing intermediate never creates an
object or a dictionary entry during writeback.

OneTime transfers without subscriptions. OneWay follows source notifications. TwoWay adds
writeback through PropertyChanged, LostFocus or explicit `UpdateSource`. TextBox defaults
to LostFocus. Target-transfer echoes queued during notification delivery are suppressed;
they do not feed a converter's output back into its own source. `UpdateTarget` refreshes
explicitly, and Loaded/Unloaded rebuild or detach the observer chain.

Source resolution supports explicit Source, inherited DataContext, the current template's
NameScope, RelativeSource Self and TemplatedParent. `createTemplateBinding` uses the same
engine with the `TemplatedParent` slot. The released `ControlTemplate.Bind` profile is
adapted through that path.

Converters receive `(value, targetType, parameter, language)`. `UnsetValue` selects fallback;
`null` selects TargetNullValue when supplied. Converter exceptions generate diagnostics
and follow the fallback path. Built-in literal conversion uses the same XAML codecs for
numbers, enums, Thickness, colors/brushes and other approved value types.

Binding failures use `SFB001`–`SFB010`: invalid path, missing source/member/index, converter
failure, conversion failure, source-write failure, update cycle, invalid target and
subscription lifetime failure. Diagnostics identify the path/step and target property,
redact values, and isolate exceptions from diagnostic listeners. An invalid SetBinding
target still raises its validation fault. Runtime source/member limits remain explicit.

See [compiled-binding.md](compiled-binding.md) for token descriptors and x:Bind, and
[property-acceptance.md](property-acceptance.md) for the issue and qualification inventory.
