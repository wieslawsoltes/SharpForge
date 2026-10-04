# @sharpforge/rendering

Application-owned retained drawing services for SharpForge. The package registers no global mutable state and accepts platform resources through explicit owners.

## Resource ownership

`ResourceTable` rejects stale, foreign and mistyped handles, retains mutable resource versions and delays disposal until the final GPU submission completes. `DeltaUpload` keeps bounded typed storage and uploads only changed aligned ranges.

## Composition state

`CompositionObject` and `CompositionPropertySet` keep native state under an explicit application owner. Typed getters distinguish missing values and type mismatches; quotas, immutable inputs, animated/base precedence, snapshots and disposal are enforced before a visual tree is attached.

## Typed animation values

`prepareValueAnimation` and `sampleValueAnimation` implement typed interpolation and discrete keyframes. Easing bounds and complete property-path validation fail before mutation. `buildTimelineDefinition` accepts explicit adapters, including endpoint-presence checks for omitted values.

## Validation

The publication manifest lists authored fixtures and the prior completed-scope evidence separately. Repairs and newly authored cases await the consolidated rerun; required core is pending on this exact branch tree. Browser pixels, native WinUI comparisons and physical GPU qualification remain separate gates.
