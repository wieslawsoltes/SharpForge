# Editor latency and retained-memory measurement

The A20-T12 harness separates **Node model execution** from **actual browser event-to-paint timing**. A Node operation is never labeled keystroke-to-paint. Missing browser engines produce an explicit `EDITOR_BENCH_BROWSER_UNAVAILABLE` failure; no placeholder browser numbers are emitted.

## Workloads

All fixtures contain ASCII source at exactly 1 KiB, 1 MiB, 10 MiB and 100 MiB. Because the input is ASCII, UTF-8 bytes and UTF-16 code units are equal. Every fixture has one unique marker in the middle, so search correctness checks the exact expected location. Paste and undo use a deterministic 64 KiB payload. Each measured edit is reversed before the next sample, and undo history is cleared outside the measured interval.

Node rows use the real `TextBuffer` and `EditorModel` implementations:

- `model.edit`: one committed character edit, verified against the edited span.
- `model.paste64KiB`: one 64 KiB edit, verified against document length.
- `model.undo64KiB`: undo of a prepared paste, with source length restored.
- `model.findLiteral`: the public bounded full-document search and exact middle-marker location.
- `model.viewportQuery60Lines`: 60 indexed lines at multiple positions. This measures text lookup, not DOM scrolling or painting.

Browser rows instantiate the real `CodeEditor` and shared `EditorModel`. They measure the interval from input/keydown/scroll event reception until two `requestAnimationFrame` callbacks have completed. Find additionally waits for its actual result and selected location before the final frames. This captures browser rendering/scheduling latency as an upper bound; it is not OS hardware-input latency or physical display presentation time. Paste uses a synthetic `ClipboardEvent` through the actual editor paste handler; system clipboard permission latency is excluded. Reports name this input method explicitly.

## Commands

```sh
node scripts/benchmark-editor.js --backend model --samples 20 --warmups 3 --output artifacts/editor-model.json
node scripts/benchmark-editor.js --backend browser --browser chromium --samples 20 --warmups 3 --output artifacts/editor-chromium.json
node --expose-gc scripts/benchmark-editor-memory.js --undo-steps 100 --output artifacts/editor-memory.json
node scripts/check-editor-perf.js --baseline docs/performance/editor-model-baseline.json --current artifacts/editor-model.json
```

`--sizes` accepts a comma-separated list of byte counts for targeted investigation, up to an explicit 256 MiB maximum. For example, `--sizes 209715200` selects the 200 MiB qualification case. Standard baseline qualification still uses the four default sizes ending at 100 MiB; accepting a larger option does not constitute a measurement of it. Browser execution supports the installed Playwright dependency, `SHARPFORGE_PLAYWRIGHT_MODULE` for an explicit installed module path, and a supported `--executable` override or `CHROMIUM_EXECUTABLE`, `FIREFOX_EXECUTABLE`, `WEBKIT_EXECUTABLE` environment variable. The loopback harness server serves only repository resources and pins the import map with a Content Security Policy hash; it does not enable `unsafe-eval`. Startup uses bounded protocol `page.evaluate` polling with cancellation and an independent deadline, including if an evaluation hangs.

## Statistics and reproducibility

Reports retain every warm raw sample, one separate cold sample, warmup count, p50/p95/p99 using nearest-rank percentiles, minimum/maximum, exact source size, backend and correctness result. Environment metadata includes Node/V8, OS, architecture, CPU, commit and browser version when used. Outliers are retained. The default is 20 measured samples with three warmups; p99 at this sample count is the observed maximum, not an estimate of a stable long-tail percentile. Increase sample counts for release performance qualification.

## Memory attribution

Run memory measurement with `node --expose-gc`. Each stage requests V8 collection twice, separated by an event-loop turn. Reports preserve signed changes in `heapUsed`, `arrayBuffers`, external memory and RSS. The buffer metric includes the source plus piece storage/index; a separate index-only delta excludes the already-allocated source. Model overhead is measured over the shared buffer. Undo retention is attributed by clearing history while preserving current source content, with actual `UndoStack.statistics` and retained bytes per operation recorded.

These are **retained-memory deltas**, not total allocation counters. Browser DOM/native allocator memory cannot be inferred from Node heap deltas and remains explicitly unavailable unless the corresponding real adapter is run. Token retention uses the actual SyntaxHighlightIndex and visible token-run query. Files above its configured lexical limit report the measured plain-text fallback with syntaxEnabled:false. The real VisualLineMap measures the logical-to-visual row index, while browser DOM is separately marked unavailable in Node.

Every component reports retained bytes and bytes per MiB of source. Budgeted retention uses heap plus ArrayBuffer bytes; external memory already includes ArrayBuffers and is not added again. Signed negative deltas are retained as GC measurement noise, never presented as negative physical memory. The fixed structural budgets are:

| Component | Retained budget | Reason |
|---|---:|---|
| Source and buffer | 64 KiB + 6 bytes per source byte | Source storage and the indexed piece tree |
| Shared model | 64 KiB | Fixed selection, undo-controller and listener overhead |
| Undo history | 16 KiB per explicit step | Bounded edit metadata and persistent-tree references |
| Token index | 1 MiB + 256 bytes per lexed character | Token/trivia objects and indexes, capped by the editor's lexical limit |
| Visual row index | 64 KiB + 24 bytes per logical line | Two typed arrays plus bounded controller overhead |

Plain-text fallback uses the token budget's fixed allowance only. Exceeding any measured component's budget makes the memory command fail; these limits are defined before measurement and are not fitted to the observed baseline.

## Regression gate

The comparison command validates the report and every raw sample/percentile before comparing. It fails if **any** size/operation/backend exceeds its baseline p95 by more than 20%; a faster unrelated row cannot offset a regression. Exactly 20% is accepted. Missing rows, duplicate rows, failed correctness, an unmeasured browser row required by `--require-browser`, or changed runtime/CPU/browser identity fail explicitly. Source commits are expected to differ and do not invalidate a comparison.

A baseline measured on a different runner is evidence, not a directly comparable CI gate. CI should use a fixed runner image/hardware and retain baseline metadata. `--allow-environment-change` exists for deliberate exploratory comparison; normal CI should not use it. Committed baseline updates require measured data and review, not hard-coded thresholds chosen to hide current results.

The root integration owns scheduling this gate once per completed editor epic/scope, not once per leaf commit. The benchmark modules do not edit package scripts or workflow files.

## Recorded baseline

Recorded 2026-10-03T21:00:40.399Z on Node v24.19.0, V8 13.6.233.17-node.51, Linux x64, AMD EPYC 9V74 80-Core Processor (9 logical CPUs visible). The product dependency revision was `9b51d3ddc371fe4c1fd49ff3c3c6759ba2911149`; benchmark source was present in the worktree during recording. The latency and memory commands ran sequentially. No before/after speedup is claimed.

The complete raw measurements are committed in [editor-model-baseline.json](editor-model-baseline.json) and [editor-memory-baseline.json](editor-memory-baseline.json). Model latency is milliseconds; no row below measures browser paint.

| Size | Model operation | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---:|---:|---:|
| 1 KiB | Character edit | 0.0137 | 0.0841 | 0.1043 |
| 1 KiB | Paste 64 KiB | 0.3838 | 1.6890 | 1.7985 |
| 1 KiB | Undo 64 KiB | 0.0142 | 0.0271 | 0.1264 |
| 1 KiB | Full literal find | 0.0448 | 0.1695 | 0.1748 |
| 1 KiB | 60 indexed lines | 0.0192 | 0.0342 | 0.0656 |
| 1 MiB | Character edit | 0.0245 | 0.0775 | 0.0813 |
| 1 MiB | Paste 64 KiB | 0.7462 | 0.8136 | 0.8282 |
| 1 MiB | Undo 64 KiB | 0.0177 | 0.0413 | 0.1104 |
| 1 MiB | Full literal find | 12.9554 | 13.8197 | 13.8608 |
| 1 MiB | 60 indexed lines | 0.0565 | 0.0864 | 0.1203 |
| 10 MiB | Character edit | 0.0128 | 0.0443 | 0.0477 |
| 10 MiB | Paste 64 KiB | 0.3793 | 0.5300 | 0.9000 |
| 10 MiB | Undo 64 KiB | 0.0091 | 0.0184 | 0.0370 |
| 10 MiB | Full literal find | 130.9130 | 137.9940 | 192.9569 |
| 10 MiB | 60 indexed lines | 0.0342 | 0.0472 | 0.0796 |
| 100 MiB | Character edit | 0.0111 | 0.0224 | 0.0456 |
| 100 MiB | Paste 64 KiB | 0.3809 | 0.4949 | 0.8826 |
| 100 MiB | Undo 64 KiB | 0.0074 | 0.0159 | 0.0479 |
| 100 MiB | Full literal find | 1298.3148 | 1407.1132 | 1419.2181 |
| 100 MiB | 60 indexed lines | 0.0334 | 0.0410 | 0.0717 |

Retained memory uses heap plus ArrayBuffer bytes. MiB columns use 1,048,576 bytes. All fixed structural budgets passed.

| Source | Buffer/source (MiB) | Model (bytes) | Undo (bytes/step) | Tokens (MiB) | Token backend | Visual row index (MiB) |
|---|---:|---:|---:|---:|---|---:|
| 1 KiB | 0.0097 | 11,720 | 716.80 | 0.2262 | compiler-token-index | 0.0034 |
| 1 MiB | 1.1002 | 4,240 | 744.88 | 24.9816 | compiler-token-index | 0.1568 |
| 10 MiB | 11.0062 | 4,136 | 748.40 | 0.0034 | plain-text-large-file | 1.5026 |
| 100 MiB | 110.0056 | 4,776 | 748.40 | 0.0032 | plain-text-large-file | 15.0010 |

The complete synchronous 100 MiB search costs roughly 1.4 seconds at p95 on this runner; that number must not be used as evidence of interactive responsiveness. The browser path waits for the editor's actual asynchronous search result and its paint frames. The large-file token rows measure the configured plain-text fallback, not full-document syntax tokens.

### Qualification limits

The 11 focused harness tests passed, including the real model operation checks, memory budget boundaries, regression threshold behavior and loopback resource/CSP checks. The real four-size model and GC memory commands completed. The gate validated every committed raw percentile and returned failure for a deliberately regressed report.

Actual Chromium latency could not be recorded in this environment. The installed Playwright package had no browser executable; its supported Chromium installer exhausted its download attempts with an unusable zero-byte/non-ZIP archive. The browser command fails explicitly, and there is no committed browser baseline or browser/native qualification claim. Chromium, Firefox, WebKit, DOM retained memory, physical-display latency and desktop-native execution remain unverified.

The comparison CLI is ready for the integration-owned CI job. A job claiming browser regression coverage must provide an actual browser baseline and use `--require-browser`. A job on different CPU/runtime hardware must first record and review its own compatible baseline; the exploratory environment override does not establish performance equivalence.
