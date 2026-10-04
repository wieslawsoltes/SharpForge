# @sharpforge/rendering

Application-owned retained drawing services for SharpForge. The package registers no global mutable state and accepts platform resources through explicit owners.

## Resource ownership

`ResourceTable` rejects stale, foreign and mistyped handles, retains mutable resource versions and delays disposal until the final GPU submission completes. `DeltaUpload` keeps bounded typed storage and uploads only changed aligned ranges.

## Drawing lists

`DrawingContext` records shape, image, text and layer commands in DIP coordinates. `DisplayList` seals immutable snapshots, validates its versioned wire envelope, replays through an injected adapter and diffs retained element versions. Opaque platform objects require resource handles before serialization.

## Portable shaping engine

`loadBundledHarfBuzz` creates an isolated engine from supplied bytes or an explicit binary loader. No provider instance or Wasm memory is shared. The pinned upstream wrapper, engine, license and provenance ship together with a licensed Latin smoke face. The caller still chooses the font collection.

## Variable font fixtures and metrics

The renamed licensed fixture families preserve real weight/width axes and distinct italic outlines. Horizontal metrics use the complete48-byte native structure instead of the pinned wrapper's undersized12-byte allocation. Font and engine hashes remain explicit.

## Multilingual fixture collection

`bundledTextFixtures` returns the pinned Latin variable, Arabic, Hebrew, Devanagari and color emoji face descriptors. The explicit emoji corpus retains GSUB closure and CBDT/CBLC data, including ZWJ sequences and skin tones. A local reproduction script records the transformations and modified family names.

## Independent shaping oracle

The checked-in glyph expectations come from raw upstream HarfBuzz calls with pinned engine and font hashes. Explicit multilingual requests retain script, direction and item boundaries. A separate capture script can reproduce these expectations without importing the portable provider, font matcher, line layout or glyph rasterizer.

## Validation

Focused cases were authored and included in the completed A17 scope gate. The publication manifest records its exact prior evidence and any subsequent repair. Required core is pending on this exact branch tree. Browser pixels, native WinUI comparisons and physical GPU qualification are separate gates.
