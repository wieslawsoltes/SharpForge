# Browser and native rendering references

The reference additions are authored and unrun. Their presence does not qualify a browser,
GPU, text input path, native WinUI default, or performance target. The complete scope gate owns
execution. Every result records its actual backend and adapter; unavailable implementations
remain failures or explicit incomplete qualifications.

## Independent inputs and comparison scopes

`fixture_matrix.py` preserves all 62 original fixture identifiers and requires a reference for
each one. `fixtures/browser-matrix.json` adds acceptance cases. The runner never promotes an
implementation-generated backend golden into an independent oracle.

| Fixture family | Required reference | Scope of the evidence |
| --- | --- | --- |
| Rectangles, radii, ellipses, lines, gradients, images, clip and opacity | Separately authored native Canvas commands | Browser geometry, blending and raster agreement |
| Supported effects and composition brushes | Separately authored native SVG, with its source SHA-256 | Browser effect/brush agreement; no production display-list replay |
| Text wrapping, line breaks and ellipsis | A separately mounted DOM paragraph and independent Range/ellipsis measurements, then native Canvas text | Actual browser layout and opaque text raster agreement |
| Public control/template galleries | A second actual backend using the same public facade | Cross-backend agreement; shared managed layout/templates are not a native WinUI oracle |
| Pinned numeric glyphs | Canvas outline raster; a Canvas primary is paired with SVG | Real numeric glyph/raster agreement, preserving exact font provider provenance |
| Serialized display lists | Live Canvas versus JSON/binary replay, with exact Canvas byte equality | Serialization, retained identity and changed-element diff behavior |
| RenderTargetBitmap | Actual `host.renderToBitmap`, exact `RenderAsync`/`GetPixelsAsync` agreement and on-screen comparison | Real public capture behavior; no claim that unsupported native input overlays can be captured |
| Shared native XAML | Independent Windows WinUI pixels plus an actual distinct browser backend pair | Exact pinned native pixel comparison for those same XAML bytes only |

A paired run must actually select the distinct requested backend. A fallback to the primary
backend cannot become its own reference. Required missing references fail. A backend regression
baseline remains useful as a separate review artifact: pass `--require-goldens` to require one,
and `--update-goldens` only to deliberately record one. Updating it never bypasses the required
reference comparison.

## Acceptance matrices

The geometry extension covers corner radii from zero through 50%, strokes 0.5–20 DIPs, rotations,
DPR 1/1.5/2, stroke-only ellipse centres and visible half-pixel lines. WebGPU verification records
the real pipeline sample count. The homogeneous case contains 100,000 actual rectangles and
checks the actual submitted instance/batch count.

The atlas fixture draws 5,000 real font-instance/glyph pairs from pinned HarfBuzz inputs.
It observes real resident entries and submitted glyph instances, applies bounded pressure with
larger authentic glyphs to recycle atlas pages, restores the original list, and requires exact
before/after GPU readback bytes. The 32 MiB atlas budget is checked against actual counters.
The pairs include font variations; they are not presented as 5,000 distinct Unicode characters.
Canvas/SVG runs qualify the corpus raster only, with `atlasStatus: requires-webgpu` retained in
their evidence. The separate WebGPU run must establish residency and recovery.

The overlap fixture permits at most one byte (1/255) of error in every RGBA channel. Its
`differentPixelFraction: 0` is deliberate: a two-byte error at even one pixel fails. Larger
antialiasing tolerances in shape/text fixtures do not apply to this overlap contract.

Path bounds, lengths and hit tests use native SVG APIs. Normalized-figure qualification also
requires real `SVGPathElement.getPathData({normalize:true})` evidence. A browser without that
API reports `incomplete-native-figures`; a bounds-only comparison cannot count as a figure pass.

The retained scrolling fixture constructs 10,000 real ListView source items, changes the native
scroll offset on animation frames, and inspects the actual generated item projection and retained
text display-list identities. Rows whose item text and identity are unchanged must keep the same
list. Newly realized/recycled rows are counted separately. The runner records actual rAF interval
median/p95, submission time and renderer counters. Hardware requires a p95 frame interval of at
most 17 ms; software timing is reported under its separate tier. No frame rate is inferred from
an empty timer loop or a mock adapter.

The mixed-order fixture inserts three children in a deliberately different order from their
`ZIndex`: two real requested-backend shapes and an actual native input fallback. A renderer
contribution gives the input deterministic solid chrome so the independent Canvas reference
measures stacking rather than OS input styling. Actual hit targets and composited pixels must
agree. This is an element interleaving contract; the separate TextBox gallery owns family chrome.

CanvasControl enters through `Draw`, draws lines/rectangles/ellipses/text, invalidates once, and
checks the sealed drawing session, owner identity and exactly one new display-list version.

## Native browser composition

`native_ime_driver.py` sends Chromium's `Input.imeSetComposition` twice and `Input.insertText`
to commit. The fixture records trusted `compositionstart`, `compositionupdate`, `compositionend`
and input events, and checks the authoritative TextBox text and UTF-16 selection. It never
calls `dispatchEvent` to fabricate input. The driver follows the browser protocol advertised by
[Chrome DevTools](https://chromedevtools.github.io/devtools-protocol/tot/Input/); the artifact
records the actual browser version because this protocol capability is experimental.

This qualifies the Chromium browser composition path. It does not qualify the OS candidate UI,
platform keyboard layouts or Firefox/WebKit/Safari composition automation. A missing native
protocol is an incomplete qualification, and untrusted input cannot pass the fixture.

## Exact native XAML pairing

The optional `native_winui` workflow input enables a serial Windows job after the software job.
It uses the existing pinned SDK/CoreCLR/Windows App SDK loader and the native producer at
`native/capture.js`. The producer enforces its real toolchain/Windows image requirements and
captures 38 positive cases plus a negative native load observation. Its new output directory is
an independent provider, never a backend baseline update.

The browser loads the producer's exact seven committed XAML inputs through the public
`XamlReader.Load` API. SHA-256, DIP dimensions, requested render scale, theme and keyboard focus
must match. The negative native load case supplies no pixels and is not turned into a positive
browser reference. `--native-only --native-references <directory> --require-native` selects the
38 positive shared inputs and requires their provider packets.

Capture uses a transparent page background and premultiplied RGBA8. The reader checks the
provider pixel hash, XAML hash, source revision/dirty state, Windows x64 identity, actual command,
three consecutive stable captures and two fresh processes. It compares the actual high-contrast,
text-scale and theme observations. Native `RenderAsync` DPR is an explicit output size;
the desktop rasterization scale remains a separate recorded observation.

Text/control fixtures require an installed Segoe UI face through `FontFace` with `local()`.
A missing font fails explicitly instead of silently selecting a Linux substitute. Browser font
files cannot be inspected through this API, so provider font-file hashes and the browser's
successful local-face load are reported separately. Native shape defaults, when supplied, are
compared with fresh facade instances, typed getters, dependency-property getters and local-value
presence; missing/default mismatches cannot be labeled native default parity.

Native popup, composition-only, media and SwapChainPanel capture remain outside this static XAML
producer. Platform-dependent differences and released ABI deviations are preserved in evidence,
not edited out of the fixtures to obtain a passing result.
