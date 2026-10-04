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

## XAML syntax and literals

`XamlXmlReader` reads positioned, namespace-aware XML with independent byte, node, depth and text budgets. `XamlSchema` provides a closed registered type/member allowlist and explicit namespace aliases. `convertXamlValue` converts documented scalar, enum and UI value literals and delegates optional geometry conversion to the host. Object construction, markup extensions and serialization are added by subsequent XAML writer batches.

## Observable bindings

`BindingOperations` installs OneTime, OneWay and TwoWay bindings into PropertyStore source slots. Nested member/indexer paths subscribe only to the affected suffix; DataContext, ElementName, Self and templated parents share that tracker. PropertyChanged, LostFocus and explicit source updates preserve converter/ConvertBack and null/fallback rules. TemplateBinding uses the same engine. Unload/dispose release observers; snapshots restore subscriptions without replaying source getters, converters or diagnostics. SFB001–010 errors are bounded and redact values.
