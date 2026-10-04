# Native XAML pixel references

This producer renders the checked-in XAML with the real, locked WinUI runtime.
It reuses `tests/conformance/oracle/WinUI/Oracle.WinUI.csproj`, its NuGet lock,
the repository oracle toolchain verifier, and the bounded native process runner.
It does not add a package dependency or call the SharpForge renderer to create a reference.

## Run on the pinned Windows lane

Use an interactive Windows x64 desktop, Windows build 19041 or later, the exact
.NET SDK 10.0.201/CoreCLR 10.0.5/reference pack from
`planning/qualification/oracle-toolchain.json`, and locked Windows App SDK
1.8.260921001 packages. Hosted Windows image identity is verified against that file;
image drift fails. A local run records its actual environment and is not represented
as an immutable hosted image. Set `SHARPFORGE_ORACLE_DOTNET` when the pinned SDK is
outside `PATH`.

From the repository root, choose a new output directory:

```sh
node tests/rendering/native/capture.js --output artifacts/rendering/native-winui
```

The runner builds once, then launches **two fresh native processes serially**.
Each fixture is attached to a visible Window, laid out in its declared DIP size,
and rendered by `RenderTargetBitmap.RenderAsync(element, pixelWidth, pixelHeight)`.
The producer waits for three identical captures across actual rendering turns,
with a limit of 120 turns and a 240-second process timeout. It requires the two
processes' observations and pixel hashes to agree before exporting references.
No fixed sleep is used as a claim that pixels have settled.

`captured-native-reference` means that this producer completed. Browser parity is
a separate comparison; it is not implied by a successful native capture. Missing
native dependencies, non-Windows hosts, unsupported XAML, unstable pixels, failed
loads, cancellation, and corrupt or oversized output never create placeholder pixels.
The CLI exits unsuccessfully for an unsupported host as well as for failed capture.

## Shared input and output contract

`fixtures.json` version 1 declares 38 positive captures and one intentional native
XAML load error. The six positive input files cover shapes, path fill rules and
strokes, gradient brushes, asymmetric borders, text layout, and default controls.
Each runs in Light/Dark at requested render scales 1, 1.5, and 2. Two additional
cases put actual keyboard focus on the named default Button. Every case pins its
exact UTF-8 XAML SHA-256. A browser comparison must load those same bytes, preserve
the DIP viewport, theme, focus request, and transparent background, and match the
declared physical dimensions.

The requested `dpr` is an **explicit RenderTargetBitmap output scale**. It does not
change the desktop monitor's DPI. `rasterizationScale` records the actual native
`XamlRoot` scale separately, and the reference declares
`rasterScaleMode: "render-target-explicit-size"`. Qualification that depends on
layout at a particular physical monitor DPI requires that environment too.

Successful output includes:

| Artifact | Meaning |
| --- | --- |
| `report.json` | Source revision/dirty status, commands, pinned and resolved tools, binary hashes, attempts, failures, reference index |
| `attempt-1/native.json`, `attempt-2/native.json` | Native observations and actual environment from each fresh process |
| `attempt-N/<id>.bgra` | Original top-left BGRA8 bytes returned by native `GetPixelsAsync` |
| `<id>.rgba.gz` | The same pixels with B/R channels exchanged, premultiplied RGBA8, gzip compressed |
| `<id>.json` | Versioned `referenceKind: "native-winui"` provenance for the paired RGBA file |

Each reference records the WinUI tool version, exact SDK pin, operating system,
input/material/XAML hashes, source commit, capture command, dimensions, alpha mode,
color space, BGRA/RGBA hashes, actual native theme, text scale and high contrast.
Channel conversion verifies the premultiplied invariant; it does not silently
unpremultiply, clamp bad alpha, or fill transparent pixels. The negative XAML case
records the actual exception type and HRESULT and has no pixel artifact.

The producer also constructs fresh native Rectangle, Ellipse, Line, Path, Polygon,
and Polyline instances and records their actual `StrokeThickness`, `Stretch`, and
whether either property has a local value. Per-reference `nativeDefaults.shapeDefaults`
retains those observations. The consumer compares fresh browser framework objects
with the captured values; an older artifact without these observations cannot
qualify the native-defaults criterion. Expected defaults are not inserted by this harness.

Segoe UI is explicitly requested by the text input. Available Segoe UI, bold,
symbol, and emoji font files are hashed. This records installed files; it does
not assert which fallback face supplied each native glyph. Browser text parity
requires the matching font environment. A Linux fallback font is not an equivalent
native oracle. Portable shaping goldens are covered independently by the pinned
raw HarfBuzz capture, outside this pixel producer.

## Capture profile and limits

`static-xaml` admits the declared XAML shapes, transforms, brushes, layout panels,
text, and stationary controls. It prohibits DTDs, external image/resource sources,
live bindings, custom namespaces, and visual types outside its explicit profile.
Input is bounded to 128 fixtures, 256 KiB per XAML document, 4 MiB aggregate XAML,
4096 pixels per dimension, 4 million pixels per fixture, and 16 million pixels per
capture set. Native output paths and byte counts are verified before conversion.
Output directories must be new; existing captures and tracked files are never
overwritten. Cancellation terminates and reaps the active native process, removes
temporary build files, and preserves a failure report plus any actual raw output.

RenderTargetBitmap does not establish parity for separately hosted popups,
composition-only visuals, media, WebView, SwapChainPanel, or desktop backdrop/Mica.
Those require an explicit native window/composition capture provider. This profile
does not claim physical GPU validation, display HDR/ICC characterization, device-loss
timings, screen-reader behavior, or performance at 60 Hz. The native executable has
not been run merely by checking in this harness and its test sources.

## Regression tests and comparison

At the completed-scope validation slot:

```sh
node scripts/limited.js node --test tests/a17-native-pixel-*.test.js tests/a17-native-shape-defaults.test.js
```

These tests exercise data contracts, source hashes, actual BGRA/RGBA conversion,
limits, output ownership, serial process orchestration, cancellation, and disposal.
Injected executable doubles use explicit `fixture-only` provenance and temporary
buffers. They are not WinUI pixel goldens or proof that the C# executable compiled.

The browser runner consumes matching `<id>.json` / `<id>.rgba.gz` references through
`--native-references artifacts/rendering/native-winui`. Native fixture selection and
`--require-native` belong to the shared-XAML browser comparison; unrelated fixtures
cannot borrow a native reference just because their subjects look similar.
