# Rendering comparison evidence

The comparison helpers consume real premultiplied RGBA8 captures. They bound image dimensions, compressed and decoded
bytes, PNG encodings, pixel tolerances and artifact identifiers before comparison. PNG output uses straight alpha.

Backend golden updates require an explicit update flag. Ordinary comparisons are read-only and fail if a backend
reference is absent. Their metadata must match the backend, adapter tier and capture mode. A backend baseline does
not establish native WinUI parity.

Native references are read only from an explicit provider directory. Each capture must identify native WinUI,
the pinned Windows App SDK version, tool version, capture command, operating system, dimensions and alpha convention.
Missing native captures remain `pending-native`; a backend update can never create native provenance.

Independent Canvas references declare their actual provider and glyph-access contract. Missing required references,
invalid profiles, wrong dimensions, malformed buffers and failed differences cannot qualify a fixture.


## Measurement budgets

`budgets.bench.js` accepts actual finite WebGPU measurements and an identified hardware/software tier. Mock results,
backend fallback, missing metrics and incomplete captures fail. Initial absolute thresholds in `budgets.json` are
not measured speedup claims. The additional 5% regression rule requires matching fixture, resolution, capture mode,
adapter, driver and browser; an absent or incompatible baseline fails rather than silently changing the comparison.

## Validation

`tests/a17-rendering-budget.test.js` covers finite measurements, thresholds, environment mismatch, missing values,
non-finite/negative readings, mocks and incomplete baselines. Exact-draft core and real measurement qualification
remain pending; the earlier completed A17 gate is recorded separately in the publication manifest.


## Browser adapters

`gpu_browsers.py` adapts actual Playwright Chromium, Firefox and WebKit, and actual Safari WebDriver separately.
Safari requires macOS or an explicit endpoint and reachable fixture URL. The software configuration requests a
fallback adapter, but qualification must record the adapter actually selected. Driver versions remain explicit
inventory input because WebGPU has no standard portable driver-version field.

This stage supplies browser lifecycle adapters and the hardware evidence checklist. The fixture server and runner
are installed in a dependent stage. No browser process or driver was executed while preparing this publication.
