# @sharpforge/winui-properties

Application-owned UI services for SharpForge. Instances have explicit lifetimes; the package has no external runtime dependencies or import-time registrations.

## UI member adapters

`UIExtensionRegistry` registers constructor, method and property handlers by owner and signature. The injected context owns platform conversion and task handling.

## Dependency property registration

`DependencyPropertyRegistry` allocates immutable identities per owner and validates defaults before publishing them. Attached properties retain their declaring owner; inherited lookups reuse that identity. `PropertyMetadata` supplies callbacks, factory defaults and validation policy to the consuming host. Registry snapshots retain token identity and reject cross-registry tokens.

## Effective values

`PropertyStore` keeps the ordered value sources for one dependency object, applies inherited values, validates transactions before publication and emits effective changes through a bounded FIFO queue. Animation removal reveals the current underlying value. Snapshot and restore preserve callbacks and identity without replaying notifications. Read-only property writes require an injected host capability. `EffectiveValueEmitter` tracks weak consumers of mutable value nodes.

## Observable sources

`ObservableObject` publishes property changes and `ObservableVector` publishes indexed collection deltas. `SubscriptionLifetime` explicitly attaches and detaches subscriptions as owners load, unload and dispose. Listener snapshots restore saved subscription identity without invoking factories or replaying notifications.

## Resources and scopes

`ResourceDictionary` supports keyed entries, reverse-order merged lookup, theme dictionaries and transactional mutation. Cycle, size and reentrancy limits are checked before publication. `ResourceScope` searches local and ancestor scopes and observes resource changes with explicit disposal. `StaticResource` references capture a value; `ThemeResource` references follow the live scope. `DeferredResource` constructs a resource once and owns its lifetime.

## Fluent theme resources

`FluentResources` provides the pinned Light, Dark and HighContrast color and brush catalog. The resource inventory records its upstream revision; THIRD-PARTY-NOTICES.md contains the accompanying license. Accent ramps update live consumers, and `connectThemeHost` attaches browser theme and forced-color observations that disconnect with their explicit lease. HighContrast values use CSS system color tokens.

## Object lifetimes and UI dispatch

`UIObjectTree` keeps logical and visual parents, bounded host-coordinate lookup and loading/unloading state. `DispatcherQueue` serializes work by priority and FIFO order on an injected logical UI thread. `RoutedEventRegistry` owns event identities; `RoutedHandlerList` delegates actual routing to the injected host router. `DisposableScope` owns subscriptions and supports in-memory rewind without replaying factories.

## Templates and content

`ControlTemplate`, `DataTemplate` and `ItemsPanelTemplate` create fresh per-instance trees with private namescopes. `TemplateHost` replaces and disposes one control template, retaining initial ApplyTemplate/layout timing and snapshot identity. Template bindings subscribe to the owner property store. `ContentPresenterController` resolves explicit templates, selectors, implicit data templates, primitive content and already-owned UI elements through its injected adapter.
