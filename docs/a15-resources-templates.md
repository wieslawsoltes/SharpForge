# A15 resources, styles, templates, items and XAML

This document describes the executable Project 14 UI profile implemented by
`@sharpforge/winui-properties`, the compiler UI profile and the runtime/JavaScript
host adapters. The corresponding issue and fixture inventory is in
[a15-resources-acceptance.md](a15-resources-acceptance.md).

## Architecture and public surface

The dependency-property store is authoritative for effective property values.
Resource, style, template, binding and animation services contribute values to
its declared precedence slots. Managed C# and the JavaScript facade use the same
models through `UIExtensionRegistry` registrations. Constructors, property
accessors, methods, collection operations and managed callbacks retain their
registered ABI signatures.

Applications import the package entry point. Subgroup `index.js` files organize
the implementation without introducing cross-package deep imports.

| Group | Public API | Responsibility |
|---|---|---|
| Resources | `ResourceDictionary`, `ResourceScope`, `DeferredResource`, `ResourceReference`, `staticResource`, `themeResource` | Indexed lookup, deferred construction and consumer invalidation |
| Fluent | `FluentResources`, `createAccentRamp`, `parseAccent`, `xamlColorToCss`, `connectThemeHost`, `systemColors` | Theme catalogs and explicit host color/theme signals |
| Styles | `Style`, `Setter`, `StyleSelector`, `StyleApplication`, `prepareSetters`, `resolveSetter`, `transactionStores` | Typed, sealed definitions and transactional property-store layers |
| Templates | `NameScope`, `FrameworkTemplate`, `ControlTemplate`, `DataTemplate`, `ItemsPanelTemplate`, `DataTemplateSelector`, `TemplateContext`, `TemplateInstance`, `TemplateHost`, `templatePartContracts` | Fresh trees, namescopes, template bindings and ownership |
| Items | `ItemContainerGenerator`, `ContainerContentChangingEventArgs`, `CollectionView`, `CollectionViewSource`, `GroupStyle`, `ItemsSourceController` | Incremental source changes, recycling, phases and grouping |
| Visual states | `StateTriggerBase`, `StateTrigger`, `AdaptiveTrigger`, `VisualState`, `VisualStateGroup`, `VisualTransition`, `VisualStateManager`, `VisualStateAnimationAdapter`, `activeState` | State selection, property layers and cancellable animation lifetimes |
| XAML | `XamlXmlReader`, `readXamlNodes`, `parseXaml`, `XamlSchema`, `XamlObjectWriter`, `XamlWriter`, `XamlParseException`, `convertXamlValue`, `convertXamlColor`, `parseMarkupExtension`, `resolveMarkupExtension`, `registerXamlResourceTypes`, `createFrameworkXamlSchema` | Separate bounded parsing, allowlist validation, construction and serialization |
| Object model | `UIObjectTree`, `DispatcherQueue`, `DispatcherQueuePriority`, `RoutedEventRegistry`, `RoutedHandlerList`, `DisposableScope` | Logical/visual identity, lifecycle, dispatch and owned subscriptions |
| Host integration | `registerResourceAdapters`, `registerObjectModelAdapters`, `getResourceServices`, `initializeItemsContext`, `initializeContentPresentation`, `createItemContainerAdapter`, `createContextXamlLoader`, `installDefaultTemplateCatalog` | Explicit integration with managed and JavaScript contexts |

Host contexts supply creation, reads/writes, property storage, type identity,
managed invocation, collections, scheduling, visual parenting and value
materialization. Resource adapters register against that capability object.
`getResourceServices(context)` exposes `applyStyle`, `applyTemplate`,
`getTemplateChild`, `styleApplication`, `templateHost`, `templateModel` and
`refreshStyleModel`. It is a reconstructible service; the owner-bound models
carry the state needed for rewind.

## Resource lookup and theme changes

`ResourceScope` searches the nearest element dictionary, then its resource
ancestors, then the application scope. Local entries shadow merged dictionaries;
later merged dictionaries win. Theme dictionaries participate using the scope's
effective theme. A dictionary is checked for merge cycles before the new graph
is published. Missing keys and recursive deferred factories have stable
`SFRES` diagnostics.

`StaticResource` captures its value on resolution. `ThemeResource` records the
dictionaries and scope dependencies needed to update its consumer. A dictionary
mutation validates all affected consumers before committing. An invalid brush or
setter value leaves both the dictionary and existing consumers unchanged.
Changing an element's requested theme invalidates its affected subtree, with
nested explicit theme choices preserved. Theme events report effective changes
once. The host bridge also updates the element's `data-theme` value.

Deferred dictionary entries store factories and their declaration order. The
first lookup materializes a resource once; template resource lookup returns a
reusable factory definition whose content is constructed separately for every
use. A static reference to an entry declared later in the same deferred lexical
scope reports a diagnostic. Factories and observer leases have explicit disposal
and snapshot behavior.

### Fluent reference inventory

The checked-in Light, Dark and HighContrast dictionaries use the MIT-licensed
Microsoft UI XAML Common resources at commit
[`7b68d3e0b771a57d80098799406234efee479517`](https://github.com/microsoft/microsoft-ui-xaml/blob/7b68d3e0b771a57d80098799406234efee479517/controls/dev/CommonStyles/Common_themeresources_any.xaml).
`packages/winui-properties/src/resources/fluent-inventory.json` records that
revision, upstream blob identity, and the 184 color/brush keys for each theme.
The coverage fixture enumerates the complete pinned inventory and reports
missing keys directly.

HighContrast resources preserve semantic system colors such as `Canvas`,
`CanvasText`, `Highlight` and `HighlightText`. The host can supply the actual
system-color palette, dark-theme preference and forced-colors state. Explicit
requested themes remain part of normal theme inheritance while forced-colors
selects the accessible resource branch.

An accent update rebuilds the affected catalog values and notifies live theme
consumers. `createAccentRamp` accepts the seven actual UISettings accent colors
through `systemRamp`. Its browser fallback computes a deterministic linear-sRGB
tonal ramp; it does not claim to reproduce an undocumented Windows accent
generation algorithm. The reference inventory covers Common color/brush
resources. Control templates are supplied by the separate, explicit control
family recipe catalog.

## Styles and transactions

`Style` has a typed target, optional `BasedOn`, and setters. Compilation resolves
dependency-property identities and checks the target ancestry. A successful
application seals the style, its setters and its base chain. Reusing an already
sealed base remains valid. Changes to a sealed definition report `SFSTYLE016`.

Default styles, implicit type-key styles and explicit styles use distinct
property-store sources. Setting an explicit null style opts out of the implicit
style. Clearing local property values reveals the currently active lower layer.
`Setter.Target` resolves a named template part and its declared property.
Resource-valued and binding-valued setters use the same validation and lifetime
services as ordinary XAML assignments.

All setters are resolved and validated before a style layer is changed.
`StyleApplication` commits affected stores transactionally. The managed
`UIStyleJournal` records only touched stores, owner records and model snapshots;
it does not copy the whole managed heap. The 1,000-control fixture asserts this
with a heap-snapshot counter and checks that an invalid second setter preserves
both previous property values and the previous style reference. Benchmark
measurements are recorded separately from that functional counter.

## Template ownership and content

`FrameworkTemplate` is a synchronous factory definition. Every instantiation
gets its own `TemplateContext`, `NameScope`, lifetime and visual tree. A factory
that returns the same mutable visual twice, a cycle, or a tree outside its budget
fails explicitly. Name lookup is indexed; nested template boundaries own their
own names. Deferred name reservations realize content only on explicit lookup.

Hosts expose `withConstruction(action, roots)` through `UIConstructionRoots`.
Nested synchronous XAML and template factories share an active, bounded root set
until the outer operation publishes its result. Managed constructors, arrays,
model wrappers and callback results join that set while it is active. Both a
successful return and a fault release it; it does not create persistent heap
pins or strong handles. Host calls synchronize authoritative template and content
models after replacement so their heap edges retain only the current instance.

`TemplateHost` validates the target type, prepares a new instance, attaches it,
calls the owner's actual `OnApplyTemplate` override and disposes the old
instance. `GetTemplateChild` returns the part from that instance's namescope.
Disposal stops bindings, triggers, animations and event subscriptions before
detaching visuals. It clears old templated-parent links and runs each visual
disposer once. Template bindings use the dedicated templated-parent source slot
and subscribe to the parent's effective value.

`ContentPresenter` supports primitive text, an existing UI element, a
`DataTemplate`, or a `DataTemplateSelector`. Template content receives the
presented data as its data context. Primitive text participates in inherited
foreground and text properties. Replacing content releases the previous data
template and subscriptions. Existing UI content has one parent and cannot be
silently shared by multiple presenters.

The control-family default catalog materializes real Grid, Border,
ContentPresenter and ScrollViewer nodes. Recipes declare named parts such as
`LayoutRoot`, `RootBorder`, `PART_BehaviorRoot`, `FocusVisual` and
`SelectionVisual`. The renderer mounts its owned behavior subtree into the
declared slot. Native behavior and managed template ownership therefore share
the same visual tree and item containers.

## Items, grouping and bounded scene projection

`ItemContainerGenerator` owns preparation, content, container style, data context,
phase callbacks and recycling. Realized index/container lookups are indexed.
Occurrence keys distinguish equal or repeated items and remain stable across
incremental insertion, removal, replacement and movement. Recycling invalidates
queued phase work before clearing the old item. Each realization owns its
bindings and event subscriptions, so an old item cannot update a recycled row.
Local container property values retain their precedence when the container is
assigned another style.

`ItemsSourceController` consumes normalized collection changes. Native observable
vectors and managed list projections expose the same Count/indexer/INCC view.
Managed lists use actual declared members through
`context.bindingServices.collection(reference)`. `Items` is read-only while an
`ItemsSource` is set. Grouped sources use the same projection for nested item
lists. `CollectionView` provides current-item navigation and cancelable current
changes; group presentations use actual GroupItem/header presenters and their
independent header/container styles.

`ItemsPanelTemplate` creates a fresh registered Panel for each owner. The panel's
layout metadata drives the existing native repeater. The managed generator owns
content; the native repeater owns viewport placement and requests realized
indices. The initial request is bounded to 64 items and an explicit request may
contain at most 2,048 indices.

Scene transport sends a sparse `$items` descriptor with count, revision,
selection ranges, stable realized occurrence keys, managed container references,
visible group/header records and the panel reference. `$itemContainers` contains
the actual realized visuals. It does not manufacture a million placeholder
elements or serialize every source value on each viewport update. Authoritative
source storage remains bounded to one million items and is retained through the
original managed source reference when available.

## Visual states, dispatcher and trees

Visual states contribute to the `VisualState` property-store source. Exiting a
state restores the lower style/default layer and preserves higher local values.
Group events carry the previous state, next state and owner. State changes
requested during a callback are queued with a bounded reentrancy budget.
Transitions cancel their previous animation handle; generation checks prevent a
late completion from restoring an obsolete state.

Active custom triggers outrank adaptive triggers. Adaptive ties prefer the
greatest minimum width, then height, then declaration order. Managed subclasses
of `StateTriggerBase` call the protected `SetActive(bool)` through the same model.
Removing or disposing the state manager releases its trigger subscriptions.
The host input bridge drives CommonStates, FocusStates and CheckStates through
the owner manager; browser qualification covers their actual input routing.

`DispatcherQueue` provides High/Normal/Low priorities, FIFO ordering within each
priority, accurate logical-thread access, bounded drains and shutdown rejection.
The host injects the cooperative scheduler and callback invocation. Queue
snapshots preserve pending work without executing it during restore.

`UIObjectTree` keeps visual and logical parenting separate. Template parts have
the owner as their logical parent while their visual parent remains the actual
template container. Lifecycle updates emit Loading before Loaded, dispose in
reverse tree order, and report size changes only when the size changes. The A16
routed-event engine consumes this topology; A15 registers typed routed-event
identities and owner-scoped subscriptions, including handled-events-too and
stable interleaved subscription ordering on rewind.

## XAML loading policy

XAML passes through four explicit stages: bounded XML parsing, closed schema
preflight, registered construction/assignment, and owned initialization. Schema
preflight finishes before the first constructor runs. It checks type and
directive identities inside deferred templates as well. Ordinary `Load` defers
template member validation until instantiation;
`LoadWithInitialTemplateValidation` checks those members during initial loading.

The executable allowlist comes from declared framework registry types, their
properties, attached members, events and collection operations. An embedding
host may explicitly register a user type with `xamlLoadable: true` and an approved
constructor, or provide a custom `XamlSchema`. A `using:` namespace string alone
does not grant permission to activate a CLR type. Framework types lacking an
approved constructor fail on construction.

The loader has no filesystem, network, reflection or script capability. DTDs,
custom entities, external entities, arbitrary processing instructions,
`x:Code`, `x:Class`, `x:FactoryMethod` and `x:Arguments` are rejected.
Only XML predefined entities and valid numeric character references are decoded.
Unknown expanded names, duplicate attributes, illegal Unicode/XML characters,
unbound prefixes and invalid reserved namespace declarations are positioned
diagnostics.

Allowed XAML directives are `x:Name`, `x:Key`, `x:Uid`, `x:Phase`, plus `x:Load`
when an explicit deferred-element capability is installed. `x:DataType` and
arbitrary native XAML directives are outside this profile. A deferred element
requires a name and a declared insertion point. Its activation owns fresh
subscriptions and can unload and reactivate without stale names or callbacks.
`x:Uid` uses the host's `stringResourceLoader`, declared property conversion and a
disposable localization lease.

Supported markup extensions include StaticResource, ThemeResource, Binding,
TemplateBinding, RelativeSource and the registered XAML Null/Type/Bind forms.
Nested arguments are parsed structurally, including commas inside expressions.
`x:Bind` uses compiler-resolved type/member/event metadata tokens. UI source
assemblies anchor supported UI and bounded BCL MemberRefs during emission so
dynamic XAML can resolve real tokens. An external assembly without the needed
tokens requires an approved metadata module; missing metadata reports an
unsupported diagnostic. Source strings are never evaluated as JavaScript.

`XamlParseException` retains its stable diagnostic code and source span. Managed
`XamlReader` failures are typed exceptions with Message, LineNumber and
LinePosition. JavaScript callers receive the corresponding Error object.

### Default budgets

| Input or model | Default bound |
|---|---:|
| XML input, conservatively counted as UTF-16 bytes | 8 MiB |
| XML token stream / depth | 200,000 nodes / 256 levels |
| Attributes per element / XML name length | 256 / 1,024 characters |
| Text or attribute value | 1 MiB |
| Markup extension input / nesting | 65,536 characters / 32 levels |
| One converted literal | 16,384 characters |
| Explicit XAML type registrations | 10,000 |
| Template visuals / depth | 100,000 / 512 levels |
| Active construction roots / nested operations | 1,000,000 / 512 |
| Names per namescope | 100,000 |
| Resource dictionaries / dictionary depth / entries | 4,096 / 256 / 100,000 |
| Resource scope ancestry / affected subtree | 4,096 / 100,000 |
| Item source / recycle pool | 1,000,000 / 256 |
| Visible item request | 2,048 |
| Group definitions | 100,000 |
| Visual state groups / states | 256 / 4,096 |
| Transitions per group / setters per state / triggers per state | 4,096 / 16,384 / 1,024 |
| Reentrant state changes per drain | 4,096 |
| Dispatcher pending callbacks / callbacks per drain | 100,000 / 256 |

Hosts may configure supported bounds explicitly. Input exhaustion produces
diagnostics or a declared queue rejection; cancellation is observed before
construction and during template traversal. The deterministic hostile-XAML
corpus exercises unknown types, deferred unknown types, DTD/entity expansion,
depth, independent size limits, namespaces, characters and cancellation without
running a constructor.

### Literal conversion and serialization

`convertXamlValue` is pure and returns immutable value descriptions. Managed and
JavaScript hosts materialize those into their registered value/brush types
before property-store validation. The literal fixture table covers more than 80
positive spellings plus negative/range cases, including integer bounds,
single-precision rounding, Thickness, CornerRadius, GridLength, Color/Brush,
Point/Size/Rect, Duration, KeyTime, TimeSpan, FontWeight, FontFamily, Uri and enums.

Reference grammars are recorded against Windows App SDK 1.8:
[Thickness](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.thickness?view=windows-app-sdk-1.8),
[Colors](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.colors?view=windows-app-sdk-1.8),
[Duration](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.duration?view=windows-app-sdk-1.8)
and [KeyTime](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.media.animation.keytime?view=windows-app-sdk-1.8).
Examples of deliberate reference details are the documented three-component
Thickness spelling, Transparent's `#00FFFFFF` color, seven fractional time digits
and signed 64-bit tick bounds. Property names and converter names never resolve
through inherited JavaScript prototype members.

`XamlWriter` serializes the current object graph canonically using registered
getters and serializers. It preserves explicit null, resource references,
bindings, dictionary order and deferred template syntax. It returns a string;
it performs no source-file edits. Cyclic graphs and unregistered runtime-only
objects fail explicitly. A code-first factory requires a registered serializer
because its executable function cannot be reverse-engineered into XAML.

## C# subclass and value ABI profile

The compiler accepts source inheritance chains rooted in registered
`Microsoft.UI.Xaml` types and the declared UI callback interfaces. It emits base
and interface metadata, absolute source field offsets, virtual-slot identities
and explicit base construction. Base calls stay statically bound; managed
callbacks dispatch to real source overrides. UI `is` checks and checked casts use
the runtime type tables, including event sender and OriginalSource. Lowered
delegates carry explicit identity metadata for canonical/source/direct-CIL use.

Framework out parameters retain actual `T&` signatures. Source reference cells
and emitted CIL addresses use the shared by-reference lowering, and the host
writes through `context.writeReference`. Object-valued UI calls preserve exact
boxed primitive/value types instead of guessing a type from a JavaScript number.

The bounded nullable ABI supports the declared scalar UI boundary types and
DateTimeOffset/TimeSpan records. Source nullable locals support int, uint, float,
double, bool, DateTimeOffset and TimeSpan with presence, Value, GetValueOrDefault,
construction, coalescing, null tests and approved numeric conversions. Single
values round to binary32 and UInt32 values preserve their full unsigned range.
Numeric casts carry explicit source and destination types to the shared runtime,
which distinguishes unchecked integer wrapping from floating saturation and
enforces checked overflow. The emitted CIL keeps typed boxes and uses unsigned
widening where required. Scalar float/uint variables, defaults and comparisons
are supported; their nonconstant arithmetic, general lifted arithmetic and
arbitrary source Int64 arithmetic remain explicit unsupported profiles.

Direct CIL uses real nullable presence values, including zero versus absent,
`initobj`, boxing and `unbox.any`. A missing Value throws
InvalidOperationException; a wrong underlying box throws InvalidCastException.
Addressable `unbox Nullable<T>` has an explicit unsupported diagnostic. Date/time
payload records contain no hidden managed references. `null` remains null across
both host conversion directions.

## GC, rewind and qualification

Owner models implement `retainedValues()` for managed references. Sources retain
their source data once where possible, while observer closures avoid becoming
unintended global owner roots. Template, style, resource, item, dispatcher and
state snapshots restore authoritative state and subscriptions without invoking
constructors, replaying factories, notifying property observers or writing a
second scene. Collection after owner death and rewind cleanup use explicit
preserve-values disposal modes.

The authored stress fixtures include 500 controls with eight template/style
replacement rounds, weak handles for discarded template parts, host-record and
pin baselines, templates above 1,000 nodes, and 10,000 item recycles with a
constant listener count. These are correctness and retention assertions, not
performance measurements.

Run qualification centrally for the completed scope using the repository's
serial schedule and `scripts/limited.js`. The integration owner records actual
source VM, direct CIL, canonical/reassembled, browser and benchmark outcomes in
`artifacts/results/project14/`. Rust/native/Wasm UI host parity is not established
by these Node fixtures. Any failed or unmeasured acceptance gate keeps its issue
open. The property-system benchmark records median, p95 and allocations; the
baseline remains fail-closed until a real capture exists. The leaf-specific 20%
gate supplements the repository's existing performance-review requirements.
