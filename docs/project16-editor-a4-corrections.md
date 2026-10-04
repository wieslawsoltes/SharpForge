# Hosted a4 editor insight and budget follow-up

The inspected source is public main `8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557`.
The existing hosted observation is [run 37175293552, job 111356550684](https://github.com/wieslawsoltes/SharpForge/actions/runs/37175293552/job/111356550684).
This follow-up uses read-only inspection of that run's JSON, logs, Playwright trace and screenshots. It does not claim a new
browser, test or build execution.

## SF-A20-T37: Find history accessibility fixture

`a20-editor-insights.json` records eight completed checks, followed by a 30-second timeout looking for a textbox named
`Find in current file`. The screenshot and `browser_a20_insights_test/trace.zip` show that the actual Find popup and input
were visible. The input has `list="sf-find-history-1"`, connected to the native history datalist created by
[`FindReplaceWidget`](../packages/editor/src/widgets/find-replace.js). That editable history input exposes the native
combobox role. The fixture's textbox lookup did not describe the implemented control.

[`browser_a20_insights_test.py`](../tests/browser_a20_insights_test.py) now locates the exact named combobox. It also checks
that the field is visible, resolves a connected native datalist, remembers the complete regular expression, and leaves the
source unchanged during search/history updates. The original two-match assertion and exact `one(12); two(34);` replacement
assertion remain. The replacement field retains its ordinary textbox role. No product ARIA override or history removal is used
to accommodate the fixture.

The strengthened browser case is authored but unrun in this source-only correction. The a4 failure remains part of the
qualification record; the source change does not retrospectively turn that run into a pass.

## SF-A19-T23 / SF-A20-T28: independent budget stages

`editor-ui-budgets.json` correctly reports the combined capture as failed. Its Code Definition stage failed before collecting
a sample: actual workspace replacement raised `Document 'Particle.cs' is not open in this workspace` through
`DocumentService.createDocument` and `StudioDocking.resolve`. The retained definition screenshot shows the incomplete workspace
view. The production workspace-layout reconciliation correction is owned by the shell workstream; this branch does not bypass
workspace loading, manufacture a definition response or relax the 300 ms requirement.

The independent overview browser session completed. Existing a4 evidence contains exactly 105 distinct sample identities:
one first, three warmup and 31 measured observations in each of narrow, medium and wide modes. Read-only recomputation found
no missing/duplicate identities, invalid geometry, misplaced/color-mismatched annotation pixels or exceeded 16 ms observations.
Every sample retains all eight annotation kinds and actual map pixels. All three real pointer preview/navigation checks match
the requested line, 4210. There are no recorded page errors or CSP violations in either stage.

Measured observations, in milliseconds, rounded to three decimal places:

| Map mode | Measured samples | Render plus readback p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Narrow | 31 | 1.100 | 1.500 | 2.000 |
| Medium | 31 | 1.100 | 1.300 | 1.500 |
| Wide | 31 | 1.100 | 1.300 | 1.400 |

The maximum across **all** first/warmup/measured overview observations is 2.000 ms. These are existing Chromium
`153.0.8010.12` observations on Linux `6.17.0-1022-azure`, using a 1440×1000 viewport and device scale 1. The exact raw samples,
source/served-asset digests, renderer-only times and following-RAF intervals remain in the hosted artifact. The browser's
readback optimization warning is retained in the overview console log; the capture includes observation/raster-readback cost
and does not claim continuous scrolling, GPU/compositor presentation latency, physical refresh rate or Safari qualification.

The successful overview stage does not satisfy the missing Code Definition measurement. The combined verdict must remain
failed until the assembled product correction is run and the complete capture passes its unchanged validator. See the
[measurement contract](project16-editor-browser-budgets.md) for those boundaries and the scheduled commands.
