# Code Definition and scroll-bar map browser budgets

This source-only qualification addition starts from public main
`e990e9342678117090a48516ec736d92104be4b2`. It does not change product behavior or claim an execution result.
The driver is `tests/browser_editor_budgets_test.py`; registration in the Project16 performance stage is owned by the central runner.

## Original obligations and measurement boundaries

| Work item | Original acceptance | Browser measurement |
| --- | --- | --- |
| [#1459, SF-A19-T23](https://github.com/wieslawsoltes/SharpForge/issues/1459) | Moving the caret onto a method call updates Code Definition within 300 ms and never steals focus. | Actual Studio caret selection through its cursor callback, workbench render scheduler, 120 ms debounce, compiler worker, source/metadata provider and read-only tool DOM. |
| [#1497, SF-A20-T28](https://github.com/wieslawsoltes/SharpForge/issues/1497) | Marks match line positions on a 10,000-line file; map mode renders within the frame budget. | Actual built CodeEditor and OverviewRuler canvas in narrow, medium and wide modes, with exact annotation pixel checks. |

#1459 refers to the **Code Definition tool window**, not the editor's Peek Definition widget.
The source targets are two distinct method definitions in separate files; the third target is actual `Console.WriteLine`
framework metadata. The small SDK workspace is loaded through `sharpforge.loadDiskRecords`; the tool is activated through
the real `WorkbenchShell`. The test obtains the current editor through the shell's existing configured `getEditor` callback.
It does not replace services, compiler responses, the debounce, the scheduler or the tool controller.

Code Definition timing starts immediately before public `CodeEditor.setSelections`. The test polls the actual textarea's
source and selected symbol on browser animation frames, then waits for one further frame opportunity. `durationMs` therefore
includes a conservative observation/frame-opportunity delay; `observedDomMs` records the earlier matching DOM observation.
Neither value is a compositor presentation timestamp. A capture-time `focusin` listener also rejects a temporary focus
transfer that was restored before the final assertion. The source version, caller URI, caret offset, read-only state,
visible geometry, exact target text and selected symbol must remain correct.

Each target has one `first` observation, two retained warmups and fifteen measured visits, interleaved so that a prior matching
display cannot falsely complete a new visit. `first` means the first visit to that target in this loaded workspace; it does
**not** mean a cold compiler or uncached process. Workspace loading can already have built the source analysis. Separate
checks cover neutral whitespace clearing and rapid caret movement ending at the latest source target.

#1497 does not specify a number of milliseconds. This suite uses an explicit **16 ms main-thread threshold**, derived from
[CONTRIBUTING.md](../CONTRIBUTING.md), section 4's responsiveness rule. This is an operational interpretation of “frame budget,”
not a claim that the issue supplied 16 ms or that the browser has a physical 60 Hz display.

The overview source has exactly 10,000 logical lines, with no trailing newline. Public editor APIs install error, warning,
breakpoint, bookmark, saved-change, unsaved-change, find and caret annotations at separate expected pixel rows, including the
first and last lines. Saved/unsaved marks come from actual edits and `markSaved`, not direct tracking-state mutation. The
fixture remains below the large-file threshold so that map mode is genuinely enabled. Expected widths are 40, 70 and 110
pixels; the fixed viewport keeps canvas height below its 4,096-pixel backing-store cap.

For each mode, an actual `OverviewRuler.render()` runs inside `requestAnimationFrame`. `renderMs` ends when that method returns.
`durationMs` also includes full-canvas `getImageData`, forcing raster readback before the clock stops. Pixel verification occurs
after timing and checks each mark's independently calculated logical-line row, exact opaque color and actual map pixels.
The 16 ms gate applies to this **render plus raster-readback** measurement, which includes the extra observation cost.
`followingRafMs` records the next animation-frame timestamp interval separately. One first, three warmup and thirty-one
measured renders are retained per mode. Real pointer movement/clicks verify preview text and line navigation in all three modes.

These are bounded, serial component rendering probes with gaps for raw capture, not a continuous scroll stress test.
They do not establish physical refresh rate, GPU/compositor presentation latency, a Safari result, native-platform behavior
or a relative performance regression verdict. The selected supported browser engine/version is recorded exactly.

## Run only in the completed-scope qualification slot

Use the already completed production build and supported browser setup; the fixture helper does not build automatically.
Run one engine/job at a time through the repository limiter:

```sh
SHARPFORGE_BROWSER_ENGINE=chromium node scripts/limited.js python tests/browser_editor_budgets_test.py
node scripts/limited.js node --test tests/a19-a20-browser-budget-trace.test.js
node tests/editor-budget-trace.mjs artifacts/results/editor-ui-budgets.json
```

`SHARPFORGE_RESULTS_DIR` selects the output directory. `SHARPFORGE_BROWSER_ENGINE` supports Chromium, Firefox and WebKit through
the shared launcher; a WebKit observation is not a Safari certification. A missing browser/build fails explicitly.
In-memory loading is rejected. An optional `SHARPFORGE_BROWSER_URL` must serve the same completed Studio build: the capture
compares actual HTTP asset hashes against local built files, including the bundled compiler worker and relevant styles.
The independent editor fixture also serves built modules through the production HTTP server and CSP.

Before scheduling this suite on the base snapshot, integrate the separately owned Studio membership-event correction and
the editor fixture's explicit owned-editor initialization correction. Their hosted failures were observed by the central
qualification job; this measurement branch does not modify those owners' product/fixture files.

## Evidence and failure handling

`editor-ui-budgets.json` retains every completed raw observation, exact source/harness/served-asset hashes, fixture digest,
source revision, browser engine/version, OS/architecture, viewport, device scale, hardware concurrency, visibility, policy,
source selections, annotation pixels and pointer checks. Nearest-rank p50/p95/p99/max summaries are separate for every case
and phase. Every first/warmup/measured observation is gated; a slow first visit cannot disappear behind warm percentiles.

The driver writes partial observations after each sample. Each stage has its own `launch_browser` session and browser process,
with distinct `_definition` and `_overview` diagnostic directories. The first session's contexts, workers, timers and process
are closed before the next launches. A failed Code Definition stage remains recorded while the independent overview stage is
attempted. Stage exceptions pass through the shared launcher's failure cleanup before the driver catches them, preserving
trace/screenshots. A numeric budget precheck also retains those diagnostics for slow but complete captures; the strict aggregate
assessment runs only after both sessions close. Both sessions' CSP observations remain in the aggregate artifact. Browser launch,
cancellation, page errors and CSP violations remain failures. Raw evidence is not replaced with empty or synthetic passing groups.

`tests/editor-budget-trace.mjs` rejects missing/duplicate observations, altered fixture counts, forged percentile summaries,
wrong source selections, focus transfers, missing map modes/marks, invalid canvas geometry, wrong pointer destinations,
non-browser clocks, hidden pages and missing artifact/CSP evidence. Its focused Node cases use **synthetic format fixtures**;
their success validates the evidence checker only. No browser budget pass is asserted by this source contribution.

#1578's under-1% instrumentation overhead is a separate actual-Studio enabled/disabled A/B capture owned by the instrumentation
workstream. These Code Definition and map measurements do not substitute for that obligation.
