# Numeric glyph atlas and retained GPU quads

`GlyphAtlas` is an application-owned cache exported from `@sharpforge/rendering`.
It accepts real numeric glyph IDs from a shaping provider. `BrowserTextProvider` and
native-run providers retain their complete-run raster path when numeric glyph access is
unavailable. Font loading and shaping belong to the text provider; atlas residency and
GPU submission lifetime belong to the renderer.

## Provider and coordinate contract

Each glyph supplies `fontId`, `glyphId`, `fontSize`, `x`, and `y`. The font ID identifies
the loaded face, face version, and variation axes. Sizes and positions are DIPs. `x` and
`y` are the final positioned glyph origin with shaping offsets already applied; `y` is
a downward-axis baseline coordinate. Diagnostic `xOffset` and `yOffset` fields are not
applied a second time. The drawing command adds its own origin and affine transform.

The synchronous provider call is:

```js
provider.rasterizeGlyph(glyph, {dpr, subpixelX, subpixelY, color: '#ffffff'})
```

Subpixel values are fractional physical pixels in `[0,1)`, quantized into four buckets
per axis by default. A raster returns `{source,width,height,logicalBounds,alphaMode,
colorSpace,colorGlyph}`. Width and height describe physical pixels; `logicalBounds`
is `{x,y,width,height}` in DIPs relative to the already-positioned glyph origin. Bounds
include the rasterizer's phase adjustment. Pixels use premultiplied sRGB; monochrome
coverage is white with alpha, and intrinsic color glyphs preserve their RGBA values.

The `pending: true` descriptor is reserved for a color image still decoding. It has
zero physical dimensions and zero logical extents. It is never cached, and the provider
must invalidate its text service when decoding completes so the next plan retries it.
Permanent empty glyphs, such as spaces, have zero dimensions without `pending` and
retain their shaped advances without allocating atlas pixels. Await `TextLayoutService.shape`
before a deterministic capture so all required color assets are ready.

## Cache ownership and limits

Cache keys include font identity, numeric glyph ID, DIP size, DPR, and both quantized
phase buckets. Adjacent glyphs retain shaping order and batch only when they use the same
atlas page. A compiled plan pins every page it uses, including while its submitted GPU
work remains in flight. Page generations invalidate evicted coordinates. The oldest
unpinned page is recycled when residency or metadata budgets are exhausted; exhausting
the budget with live pinned pages is an explicit `SFRENDER086` error.

The default page is 2048 square, padding is one pixel, and residency is capped at 32 MiB.
Page size may be 32 through 8192; padding must leave a positive interior. Metadata defaults
to 32,768 resident nonempty entries, with a separate 512-entry empty-glyph cache.
`maxEntries` is bounded by 262,144 and subpixel buckets by 16 per axis. Numeric glyph IDs
are unsigned 32-bit integers, font IDs are bounded strings or nonnegative safe integers,
font size is at most 4096 DIPs, and raster DPR is 0.25 through 8. One glyph cannot exceed
the page's padded interior. Malformed or asynchronous raster return values fail before
mutating cache entries.

New glyphs update only their dirty shelf bounds in an already-resident GPU texture.
The first upload, a recycled page, and recovery after a device loss upload the complete
page. Every partial rectangle is validated before any upload occurs. An unchanged plan
retains its instance buffers and issues no glyph texture upload. A changed numeric run
currently rebuilds its instance plan; it still reuses resident glyph images. No numeric
instance delta-update or zero-allocation claim follows from this retained behavior.

## GPU representation and fallback

Each glyph occupies one 80-byte instance containing its DIP rectangle, atlas coordinates,
straight tint, affine placement, and intrinsic-color flag. The vertex shader generates six
quad vertices per instance. Monochrome pixels use coverage times the span's solid brush;
intrinsic color pixels preserve their RGB and use the span's alpha. Premultiplied blending
and the selected sRGB or linear working-color policy match the vector renderer.
Underline and strike-through rectangles follow the shaped glyphs in display-list order.

A provider without numeric rasterization, or a run using a nonsolid glyph foreground,
uses the existing complete-run raster fallback. This preserves a supported fallback
without treating a bitmap tile as a numeric glyph. Invalid glyph IDs/origins, unavailable
font identity, unsupported provider data, and exhausted budgets remain explicit errors.

`a17-glyph-atlas.test.js` and `a17-glyph-pipeline.test.js` contain deterministic API,
boundaries, pending decode, LRU/pin and disposal coverage. The browser conformance corpus
uses pinned HarfBuzz/font assets and same-run Canvas references at 10–72 DIPs, plus DPR,
color and variable-face cases. Authored checks are not execution evidence: shader,
physical-adapter, image and native WinUI acceptance remains pending until those runs occur.
