# Physical GPU qualification record

Status at implementation checkpoint: **not run**. No physical GPU has been qualified by the
API recorder or by authoring the browser runner. This document tracks #1993 / SF-A17-T11.3.

| Required vendor | Observed adapter / driver | Browser / OS | Report and screenshots | Status |
| --- | --- | --- | --- | --- |
| Intel | Unavailable | Unavailable | None | Pending physical run |
| AMD | Unavailable | Unavailable | None | Pending physical run |
| NVIDIA | Unavailable | Unavailable | None | Pending physical run |
| Apple | Unavailable | Unavailable | None | Pending physical run |

After the full implementation scope is ready, run on each actual machine. For example:

```sh
python tests/rendering/gpu-runner.py --engine chromium --tier hardware --vendor intel \
  --driver-version DRIVER_FROM_MACHINE_INVENTORY --output artifacts/rendering/intel
node tests/rendering/budgets.bench.js artifacts/rendering/intel/report.json previous-intel-report.json
```

Select Firefox or real Safari where that machine/browser exposes WebGPU. If it does not,
retain the failed/unavailable result and qualify the explicit fallback backend separately.
Playwright WebKit results must retain the `webkit` engine name; they are not Safari results.
Pass `--native-references` and `--require-native` when native WinUI captures are available.

Before changing a row to passed, retain the report, actual/diff/browser PNGs, commit,
OS/browser versions, physical adapter details, separately inventoried driver version,
requested and actual backend, actual adapter tier, and CPU/memory/draw measurements.
Keep initial baseline creation as an explicit `--update-goldens` change followed by a clean
comparison run. Unknown adapter identity, software fallback, missing pixels, non-finite
metrics, validation errors, or incomplete native captures cannot become physical evidence.

Software tier results have a separate result directory and baseline key. They establish
software WebGPU behavior only. No relative speedup can be claimed until before and after
measurements use the same scene, resolution, browser, adapter, and driver.
