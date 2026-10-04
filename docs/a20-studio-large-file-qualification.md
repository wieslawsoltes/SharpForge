# Actual Studio large-file ingress qualification

`tests/browser_a20_studio_large_file_test.py` covers the File-input portion of
SF-A20-T44 / #1513 on the completed production Studio build. Execution is pending;
adding the driver does not establish a browser pass or close the issue.

The driver constructs exactly 209,715,200 ASCII bytes from repeated 256 KiB Blob
chunks and unique source-boundary markers. A synthetic File enters the existing
`#file-input` change handler through `DataTransfer.files`. Studio then uses its
ordinary workspace-input ticket, source importer, chunked decoder, workspace
preflight, DocumentService adoption and mounted CodeEditor. The provider is not
replaced, and the driver does not supply a preconstructed EditorModel.

Checks cover byte and UTF-16 counts, line boundaries, original snapshot ownership,
preserved sibling models, selected document, large-file mode, clean baseline,
source-faithful bounded rows near both ends, bounded native input, real browser
keyboard editing and undo, and the production pagehide disposal chain. Source
inspection uses bounded `getText` ranges. Neither `getState`, `getWorkspace`,
`getEditorState` nor a full document getter serializes the 200 MiB source.

Register this single heavy case as a separate performance-phase outcome. Its
report is `a20-studio-large-file-results.json` under `SHARPFORGE_RESULTS_DIR`, with
the source SHA/tree when supplied by qualification, actual browser/host, partial
results on failure and the shared harness's CSP/failure artifacts. The existing
five-size editor benchmark remains responsible for event-to-paint percentiles
and the 200 MiB typing p95 below 50 ms; this lifecycle case adds no duplicate
latency benchmark or latency pass claim. The recorded opening duration is an
observation of this synthetic fixture, not a physical-disk throughput budget.

Actual OS file-picker permissions, native disk throughput, physical input and
cross-application clipboard behavior are outside this synthetic File-input case.
