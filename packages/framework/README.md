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

`contractForMember` matches registered parameters and results with the shared
`memberSignatureType(type)` spelling normalizer. This public helper maps only
the scalar CLR name `System.Decimal` to the registry keyword `decimal`; it is
used after registry canonicalization. It leaves other names, owners, byrefs,
pointers and arrays unchanged. The resolver retains the declared return type,
staticness, parameter count and nearest-member preference. Type identity and
assignability still use the unchanged `canonicalType`/`frameworkAssignable`
APIs. CIL applies this normalization only to its registered-framework lookup;
the independent Decimal/Console intrinsic keys retain `System.Decimal`.

## External readonly field profiles

Registry types may declare genuine public static readonly fields separately from
properties and method contracts. The compiler bridge exposes `FieldSymbol` values
with `Static` and `ReadOnly` modifiers, without a constant value or accessor. Fields
do not allocate ABI member IDs. For example:

```js
registry.define('System.Diagnostics.ProfileExample', {
  fields: {
    Frequency: {
      type: 'long', isStatic: true, readOnly: true,
      value: {scalar: 'long', value: '1000000000'},
      addressable: false,
      assemblies: ['System.Runtime', 'System.Private.CoreLib']
    }
  }
});
```

The closed descriptor keys are `type`, `isStatic`, `readOnly`, `value`,
`addressable`, and `assemblies`. Staticness and readonly status must be `true`.
Boolean values use a JSON boolean. Fixed-width integers (`sbyte`, `byte`, `short`,
`ushort`, `char`, `int`, `uint`, `long`, `ulong`) and floating values (`float`,
`double`) use a scalar object whose type matches the field and whose value is a
decimal string; IEEE special values use `NaN`, `Infinity`, or `-Infinity` strings.
Integral values are checked against their declared width before registration.
String fields use a primitive JSON string, bounded to 1,000,000 UTF-16 code units;
empty strings, null characters, and unpaired surrogates preserve their code units.
Other reference values, callbacks, native integers, and new Decimal field
descriptors are outside this seam. Strings are materialized lazily into retained
managed field storage; they are not substituted by ordinary weak literals.

Field maps have at most 256 entries. Registration copies and freezes each map,
descriptor, scalar payload, and assembly list. All stored data remain JSON safe.
Accessor properties are rejected without invoking their getters. 64-bit values
become runtime carriers only when an execution slot is initialized.
Transactional validation also checks replacement field maps. A failed module
contribution restores the previous immutable field graph and permits a retry.

`assemblies` defaults to `['System.Runtime']` and must include `System.Runtime`,
the source emitter's canonical facade. An explicit additional opt-in permits
`System.Private.CoreLib` when consuming native CIL; CoreLib-only profiles are
rejected. CIL admission matches the approved assembly name,
public key token, neutral culture, exact owner, field name, and signature.
Assembly versions remain intact and are deliberately flexible for facade
compatibility. Other assembly names are rejected. `addressable` defaults to
`false`; enabling it permits readable managed addresses while writes remain
rejected. Existing Decimal field address behavior is unchanged.

The Boolean `TrueString` and `FalseString` module exercises this string extension
without method IDs. See [readonly string fields](../../docs/readonly-string-fields.md)
for source provenance, allocating initialization, observer/cancellation rules, and
the pending external source-schema and typed-body contract prerequisites. The
legacy `mscorlib4` source emitter explicitly rejects readonly-string loads because
its assembly identity policy cannot emit the required approved facade.
