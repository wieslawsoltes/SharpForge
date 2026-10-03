# @sharpforge/framework

Shared closed contract registry for SharpForge's compiler, managed runtime, language service and WinUI-shaped web host. Exports types, contracts, frameworkManifest, canonicalType, frameworkType, propertiesFor, eventsFor, findContracts and enum/value helpers. There are 79 named types and 494 ABI members, including cooperative task/thread and closed delegate contracts—not 79 fully implemented native WinUI types.

The registry describes exactly supported members; unlisted names do not invoke arbitrary host JavaScript. It is a JavaScript package, not Microsoft.UI.Xaml.dll, a WinRT metadata assembly or a .NET reference assembly. See docs/winui-api.md in the source distribution for the generated member inventory.

## 0.13 contracts and timelines

The registry includes selected closed primitive collection, StringBuilder/string/Math, timeline, transform and wrap-panel contracts. `AnimationClock`, `prepareTimeline`, `timelinePosition` and `easing` provide data-only bounded timeline sampling for managed and JS hosts. Adapter reads/writes must not execute user code; completion callbacks are dispatched after updates. Snapshot data contains no executable closures. The registry is a compatibility inventory, not the complete native BCL or Windows App SDK.

Registry type entries may declare `typeKind: 'interface'`, `interfaces` (canonical
registered names), `variance` (`'in'`, `'out'`, or `'none'` for generic parameters),
and `isAbstract`/`isSealed`. Runtime dispatch `kind` remains independent of type
shape. Interface edges are validated transactionally; unknown/non-interface
edges and interface cycles are rejected. `frameworkAssignable` follows declared
base/interface edges with cycle protection. The compiler bridge and runtime
method tables retain these shapes, and interface methods are abstract. This
metadata seam does not itself implement managed comparer callback execution.
