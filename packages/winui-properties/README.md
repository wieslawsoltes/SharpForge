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

## Combined binding lifetime

Observable and compiled bindings share the same property/observable foundation. This dependency join exposes the checked expression compiler, token tracker, phase scheduler and owner groups alongside BindingOperations. All three rewind fixtures retain their assertions; deferred XAML enters after template construction is available.

## Deferred XAML binding

x:Load reserves names without creating controls. FindName and compiled load bindings realize fresh elements, preserve placement and own per-activation cleanup. Factory, attachment and afterBuild share the host construction root scope; later activation does not depend on the original writer still running. Rewind restores identities without replaying factories, user callbacks or converters.

## Binding context services

initializeBindingContext installs setter bindings, XAML bindings, compiled owner groups, phase scheduling and deferred-element ownership on an injected application context. Binding services resolve names and member access through host services and retain subscription ownership for disposal and rewind. No process-global model registry or implicit application startup is introduced.

## Application property adapters

registerPropertyAdapters installs metadata, dependency-property, Binding and observable collection members into an explicit UIExtensionRegistry. Managed hosts can disable dependencyProperties and retain their typed boxing boundary while sharing binding and collection behavior. EffectiveValueEmitter tracks mutable value dependencies per owner and batches changed scene properties; flag validation retains declared bit masks.

## Style and binding adapter prerequisites

The complete binding and deferred-construction branch now shares the typed style implementation. Only the secondary style modules and their focused model tests are carried; the newer binding/property barrels and flags validation remain authoritative. Package metadata continues to include the checked-in third-party notices.

## Resource and object adapter capabilities

Resource dictionaries, collection views, typed/legacy style definitions and selector callbacks use owner-scoped models. `initializeResourceContext` connects resource ancestry to injected application/tree/environment services. `registerObjectModelAdapters` exposes the dispatcher and shared logical/visual tree contracts; a valid detached object has no parent or visual children. Registrations do not activate framework metadata or construct an application by themselves.

## Item generator prerequisites

The reviewed item source, collection-view and recycling models now share typed styles and resource adapters. The eight item-only modules/tests are copied unchanged from the secondary branch. This is an explicit integration commit with both branch heads as parents; it does not construct containers or change source mutation behavior.

## Realized item and content services

`initializeItemsContext` realizes actual managed container references, recycles them with phased lifecycle callbacks, and publishes a bounded sparse scene descriptor. Group headers and ItemsPanelTemplate instances share the same style/template/property services. `initializeContentPresentation` owns content-template selection, data context and replaced instance lifetimes. Managed Count/indexer/INCC projections are supplied by the binding service; hosts supply scene parenting, scheduling, realized-index requests and retained owner roots.
