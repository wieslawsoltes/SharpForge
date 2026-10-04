# Rendering and animation conformance

The runner exercises real browser backends. It does not turn mock GPU API tests into pixel,
performance, or hardware qualification. Validation is staged after the completed implementation
scope; adding this runner does not mean any browser, GPU, or native reference has passed.

## Running a complete scope

Use the repository's pinned `tests/requirements.txt` for the existing Playwright dependency.
Run the Python tool from the repository root after the grouped unit/check/build gate opens:

```sh
python -m unittest discover -s tests/rendering -p 'test_*.py'
python tests/rendering/gpu-runner.py --engine chromium --tier software --output artifacts/rendering/software
node tests/rendering/budgets.bench.js artifacts/rendering/software/report.json
```

The dependent completed-scope workflow will expose this software tier only through explicit dispatch/call.
The software tier requests a fallback adapter and records what was actually selected.
A failed request, Canvas fallback, unknown adapter tier, validation error, missing reference,
image difference, or exceeded measurement budget fails the requested WebGPU qualification.

Other engine choices are `firefox`, `webkit`, and `safari`. WebKit and Safari have distinct
result keys. Real Safari needs macOS `safaridriver`, or an explicit `--safari-endpoint` and
`--fixture-url` that the remote browser can reach. Engine availability is observed at run time.
For reference fallback renders use `--backend canvas2d` or `--backend dom`.
Fallback runs can qualify those backends; they cannot qualify WebGPU.

## Capture, baselines, and native references

Each fixture preserves an actual PNG, a browser screenshot, raw-pixel hash, adapter metadata,
CPU samples, memory/draw metrics, and failure details. GPU readback copies the retained RGBA
render target and waits for mapping. Canvas reads its rendered image. DOM and default-control
galleries use a cropped real browser-compositor screenshot. This captures actual native input
and selection overlays without claiming that `RenderToBitmap` can capture native INPUT/SELECT
without a capture adapter. A fixture remains mounted until the screenshot completes.

All comparisons use premultiplied RGBA8. PNG artifacts convert to straight alpha for correct
viewing. The bounded screenshot reader supports non-interlaced eight-bit grayscale/RGB/RGBA
PNG; unsupported encodings fail explicitly. Metadata records whether capture was retained
readback or browser compositing. Mixing these baseline kinds is rejected.

Backend baselines live under `goldens/<engine>/<os>/<backend>/<actual-tier>/` and require an
explicit update flag. The update is a reviewed repository change; ordinary tests never write
tracked references:

```sh
python tests/rendering/gpu-runner.py --engine chromium --tier software --update-goldens
```

No backend golden images were fabricated during implementation. Until a real capture is
performed and reviewed, comparisons report `missing-reference` and fail. `--fixtures` accepts
an explicit subset for diagnosis after the full-scope validation gate has opened.

The native oracle pin is `Microsoft.WindowsAppSDK 1.8.260921001`, matching
`tests/conformance/oracle/WinUI/Oracle.WinUI.csproj`. Native comparison uses an external,
read-only provider directory supplied with `--native-references`; `--require-native` makes
missing native captures fail the run. Native captures are never written by `--update-goldens`.
A supplied native comparison failure always fails, including without `--require-native`.

For each fixture, the provider supplies `<id>.rgba.gz` and `<id>.json`. The JSON must contain
`referenceKind: "native-winui"`, `tool: "WinUI"`, the exact `windowsAppSdkVersion`, `toolVersion`,
`captureCommand`, `operatingSystem`, `dimensions: [width,height]`, and
`alphaMode: "premultiplied"`. Keep font, DPI, theme, and OS details in the same metadata.
Missing providers produce `pending-native`, and backend baselines never imply native parity.

Numeric text fixtures additionally capture a Canvas2D reference from the same fully shaped
HarfBuzz run and pinned fonts. They record the provider, loaded font hashes, glyph count,
and actual GPU glyph/color-instance counts. The runner saves `-canvas.png` and
`-canvas-diff.png`; a missing required Canvas reference or a failed comparison fails the
fixture. This checks the atlas/quad raster path independently of native WinUI qualification.
The font assets load only from the local pinned vendor directory through an explicit loader;
the fixture awaits shaping and color bitmap decoding before timing and capture.

## Corpus and trace policy

`fixtures/index.json` includes geometry, stroke/dash, gradient, image, text, clip, alpha,
all seven supported effects, DPR, composition brushes, trimmed paths, and 10,000 instances.
Numeric text covers 10, 12, 16, 24, 48, and 72 DIPs, DPR 2, Latin ligatures/combining marks,
Arabic, Hebrew, Devanagari, emoji ZWJ sequences, intrinsic color, and a variable italic face.
The dependent host/gallery stage restores control chrome and public-facade template fixtures after their complete host prerequisites.

The manual-clock trace corpus records 20 samples per scenario and an explicit tolerance.
Its current checked-in values are mathematical interpolation/discrete-boundary baselines;
they are not mislabeled native WinUI captures. The standard `tests/a17-animation-traces.test.js`
entry includes them in the normal unit suite. Native trace evidence remains a separate task.

## Measurement meaning

`coldFrameMs` includes fixture creation, backend setup, and first render. CPU median/p95/p99
measure frame submission on the browser main thread. `gpuDoneMedianMs` measures queue completion
latency and is not a GPU timestamp-query duration. GPU memory includes owned render targets,
pools, textures, and atlas metrics reported by the renderer. Missing values stay null and
cannot satisfy a budget. JavaScript allocations are not inferred from heap-size snapshots.

`budgets.json` defines initial absolute thresholds, not measured speedup claims.
`budgets.bench.js report.json baseline.json` additionally enforces the 5% CPU regression gate
only for matching fixture, pixel dimensions, capture mode, adapter, driver, backend, and browser.
A missing or non-finite baseline fails; changing hardware cannot silently establish a regression
comparison. Driver versions are supplied with `--driver-version` because the standard WebGPU
adapter information does not provide a portable driver-version field.

See [hardware qualification](hardware-qualification.md) for the remaining evidence before closing acceptance items.
