# Portable text

`createPortableTextProvider` initializes the pinned HarfBuzz Wasm engine and a caller-selected font collection. It returns an app-owned `HarfBuzzTextProvider`. `TextLayoutService` caches its layouts and provides the same measurement results to retained drawing and the A16 layout engine.

```js
import {createPortableTextProvider, bundledTextFixtures, TextLayoutService} from '@sharpforge/rendering';

const provider = await createPortableTextProvider({
  ...bundledTextFixtures(assetBase),
  loadBinary: authorizedAssetLoader,
  signal,
});
const text = new TextLayoutService(provider);
const run = await text.shape('office العربية אבג क्षि 👩‍💻', {
  fontFamily: 'SharpForge Sans Fixture', fontSize: 24, width: 480,
  wrapping: 'wrap', direction: 'auto', lineHeight: 36,
});
// Pass text as services.text to WinUIHost, or textService to RenderSurface.
// The owner disposes text after every renderer borrowing it has been disposed.
```

The package does not fetch arbitrary font URLs. `loadBinary(url, {signal})` is an explicit host capability. Font descriptors contain `id`, `version`, `family`, optional `aliases`, `weight` or `[minimum, maximum]`, `style`, `url` or `bytes`, and optional `sha256`. Supplied SHA256 values are verified before native font allocation. The fixture helper supplies pinned hashes and URLs relative to the application asset root.

## Shaping and layout

The provider uses real HarfBuzz glyph IDs, advances, offsets and UTF-16 cluster values. It shapes each directional script/font/style item with the surrounding line as context. It re-shapes at actual wrap and trim boundaries, so an estimate used to choose a candidate break never becomes final glyph placement. Paint-style boundaries retain surrounding context while allowing each span to keep its own foreground and decorations.

Font fallback chooses a loaded face that covers the complete extended grapheme. It preserves combining sequences and emoji ZWJ clusters. Font matching considers requested family order, weight, style, variation axes and emoji presentation. Weight and optical-size axes use the requested values when the face declares those axes. Font instance IDs include face ID, version and resolved axes, and are stable between a worker and host initialized with the same descriptors.

UAX29 grapheme segmentation, script properties and UAX14 line breaking use pinned Unicode 17 data. Bidi uses the pinned bidi-js Unicode 13 implementation, with scalar indexing expanded to UTF-16 and a corrected nonzero-line-start whitespace reset. The run records these versions. Bidi is applied to whole shaped items; RTL glyphs are not reversed a second time. Tabs advance to stops derived from the loaded face's real space advance.

Layouts support explicit line breaks, wrap, whole-word wrap, no-wrap, alignment, justification, LineHeight, MaxLines, character/word ellipsis, font spans, underline and strikethrough. The glyph origin already includes shaping offsets. Caret and selection APIs use actual shaped cluster rectangles; an offset inside a ligature or grapheme snaps to the requested affinity. They do not invent internal ligature caret positions absent from the retained cluster map.

Synchronous `layout()` performs no network work. It can start decoding a required color bitmap. `shape()` additionally waits for those images and observes cancellation. A pending bitmap returns a zero-sized `pending: true` raster descriptor and is excluded from the glyph atlas. Decoder completion increments the provider version, clears layout caches, redraws surfaces and invalidates retained GPU plans and local layer raster caches. The same unchanged display list therefore retries the glyph.

## Font and raster capabilities

TTF/OTF and TTC font directories, Unicode cmap formats 4/12/13 and variable axes are parsed with bounded offsets and counts. Outlines and their extents come from the loaded HarfBuzz font. Canvas renders those actual paths. SVG emits the same glyph outlines. WebGPU uploads bounded rasterized glyph images to the retained atlas and draws instanced quads.

Font input views are copied into exact, independently owned buffers before creating native blobs. Horizontal font metrics use a bounded native adapter because the pinned hbjs 0.8.0 wrapper allocates 12 bytes for a [native structure with 12 int32 fields](https://github.com/harfbuzz/harfbuzz/blob/main/src/hb-font.h), including nine reserved fields. The adapter owns the complete 48-byte structure, reads the three public metrics and frees it after the call. The vendored wrapper and engine artifacts remain unchanged.

The portable color profile supports COLRv0/CPAL0/1 and CBDT PNG formats 17/18/19 with all five CBLC index formats. CPAL channels are extracted losslessly and normalized at the rendering boundary. Bitmap strike metrics remain explicit physical values. PNG dimensions, ordering, permitted chunks and checksums are validated before decoding. A selected strike at or above the requested ppem is preferred; the largest available strike is used otherwise.

Intrinsic palette and bitmap colors are preserved. Solid foreground opacity applies consistently on Canvas, SVG and the GPU glyph path. A COLRv0 glyph containing both intrinsic palette layers and foreground-dependent layers uses the intact-run raster fallback so the foreground is not accidentally baked as white. Non-solid text brushes also use the intact painted-run path. These operation fallbacks are recorded separately from device fallback.

COLRv1, `sbix`, SVG-in-OpenType and other bitmap formats are outside this portable profile and report `SFRENDER146`; applications can select a native provider or load an appropriate face. The licensed fixture collection covers the declared corpus, not every writing system. Uncovered complete graphemes report `SFRENDER141`. A font-style boundary that divides a grapheme reports `SFRENDER143`. The provider does not split a surrogate pair or fabricate a missing glyph ID.

Rasterization needs Canvas2D/OffscreenCanvas or an injected `createCanvas(width, height)`. Color bitmap decode needs `createImageBitmap` or an injected `decodeImage(bytes, {signal, type})`. Pure glyph shaping and outline metadata are available without a DOM. A decoder must return actual decoded image dimensions and owned closable resources. The test PNG-header recorder is only API/metadata evidence and never a pixel oracle.

## Ownership and limits

Each provider owns its Wasm engine, HB buffer, copied font bytes, blobs, faces, variation instances, outline cache and decoded images. The glyph atlas belongs to the renderer and retains pages referenced by pending GPU submissions. Disposal clears subscriptions, closes decoded images and destroys native font resources. Immutable Unicode lookup data can be shared; user text, VM values, font objects and device resources cannot.

Default hard bounds include one million UTF-16 units, 100,000 clusters/glyphs, 4,096 lines, eight million shaping-work glyphs, four million line-break work steps, 128 font faces, 128 MiB of font bytes, bounded variation instances, 16 MiB of outline strings and 64 MiB of decoded glyph images. Callers can lower the text budgets. Oversized inputs fail with a stable diagnostic instead of silently dropping content.

The host and worker must load the same face/version/axis identities to exchange numeric glyph runs. Opaque native Canvas runs can be rasterized by the shared native path even when the host uses a portable service. Browser-native providers remain available for platform fonts and IME-related native input overlays; their glyph IDs remain explicitly opaque.

## Evidence

The source fixture requests and `capture-harfbuzz-oracle.js` define an independent capture of raw upstream hbjs glyph data. The capture imports no provider, matcher, line layout or raster code. It records engine and font SHA256 values. The focused test compares provider glyph IDs, UTF-16 clusters, advances and offsets against that capture.

`tests/rendering/fixtures/numeric-text.js` renders pinned font data through real browser backends at 10–72 DIP sizes, including variable italic and color emoji, and compares WebGPU output to a same-run Canvas reference. This checks backend raster agreement. Native WinUI captures and physical GPU qualification are separate gates. No mock API recorder or portable shaping capture can satisfy those gates.
