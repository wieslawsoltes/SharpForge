# @sharpforge/rendering

Application-owned retained drawing services for SharpForge. The package registers no global mutable state and accepts platform resources through explicit owners.

## Resource ownership

`ResourceTable` rejects stale, foreign and mistyped handles, retains mutable resource versions and delays disposal until the final GPU submission completes. `DeltaUpload` keeps bounded typed storage and uploads only changed aligned ranges.

## Drawing lists

`DrawingContext` records shape, image, text and layer commands in DIP coordinates. `DisplayList` seals immutable snapshots, validates its versioned wire envelope, replays through an injected adapter and diffs retained element versions. Opaque platform objects require resource handles before serialization.

## Pinned Unicode segmentation

Unicode17 property tables drive bounded extended-grapheme segmentation and script lookup. The checked-in license and provenance identify the source inputs and transformation. Segmentation keeps surrogate pairs, combining sequences, Indic conjuncts and emoji ZWJ sequences intact.

## Bidirectional text

The pinned bidi-js implementation supplies Unicode13 paragraph levels and visual ordering. The adapter expands scalar levels to UTF-16 and resets whitespace at each actual line boundary. Shaped RTL glyph arrays retain their original order within a visual item.

## Line opportunities

Pinned Unicode17 UAX14 rules preserve nonbreaking spaces, word joiners, explicit opportunities, CJK behavior and mandatory breaks. A caller-selected finite work budget bounds adversarial lookahead; cancellation is observed before even a short input is processed.

## Validation

Focused cases were authored and included in the completed A17 scope gate. The publication manifest records its exact prior evidence and any subsequent repair. Required core is pending on this exact branch tree. Browser pixels, native WinUI comparisons and physical GPU qualification are separate gates.
