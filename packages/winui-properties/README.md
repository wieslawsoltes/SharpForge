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

## Temporary construction roots

`UIConstructionRoots` keeps only the references issued during an active synchronous factory operation. Nested factories share the outer operation, bounded to one million distinct references and 512 nested operations by default. Both a successful return and a fault release every temporary root. Templates and content presentation forward the optional `withConstruction(action, roots)` host capability through creation, attachment and callback completion. Managed heap integration is introduced by the later VM host batch; standalone model adapters remain synchronous.

## Typed styles and transactional setters

`Style`, `Setter` and `StyleApplication` validate complete setter plans before changing any store. Typed styles seal transitively, preserve higher-precedence local/binding/animation values and track implicit/theme resources without rebuilding unrelated consumers. Definition factories can explicitly select the released `legacyMutable` profile: its weak observer leases revalidate and update all applications transactionally, with at most 1024 consumers per mutation. The actual Style(string) ABI opt-in arrives with resource adapters. BindingBase and PropertyPath definitions are carried unchanged from their independent prerequisite branch; binding execution is separate.

## XAML syntax and literals

`XamlXmlReader`, `XamlSchema` and the documented literal converters are joined from their independently reviewed branch. The lexical/type-allowlist layer has no activation capability by itself. The next writer batch connects it to the approved style/template factories and explicit constructor/property services.

## Approved XAML object construction

`XamlObjectWriter` parses and validates a complete tree before invoking registered constructors and members. Its resource/style/template builders preserve deferred resources, private namescopes and positioned failures. Markup extensions implement approved resources, template bindings and ordinary/compiled binding definitions; actual binding execution is provided explicitly by the host. Deferred child slots preserve their insertion position and own their activation lifetimes. File, network, reflection, DTD and entity expansion have no activation path.

## XAML serialization and namespace projection

`XamlWriter` serializes approved object values, resources, styles, templates and supported binding definitions. `createFrameworkXamlSchema` projects declared registry types/members and explicit CLR namespace aliases without reflection. Round trips preserve null/string/resource distinctions and positional diagnostics; inherited JavaScript object properties cannot become constructors, members, enum values or color names.
