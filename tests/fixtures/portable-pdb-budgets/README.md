# Symbol parse budgets

Qualified #2544 product `4cc4678c3f9dc89ebe71f520cd699a9922fa5b51`, with harness
head `9af3ee4b51f66f12c2743060cf508750cd847b49`, stacked on #4397 product
`9614e374bc96a1d6d4dabba34b394717d315e5b6`. The reference preflight and
SymbolError binary boundary are reused; no new CIL parser is introduced.

Fourteen passing new tests cover each budget at the exact boundary and limit+1, plus
zero-byte CDI records, repeated handles, compressed/stored source sizes,
preflight before malformed inflation, invalid options, existing file/per-source
caps, cancellation and retained Roslyn corpora. No native rebuild occurred.

The new object controls symbol projection and decoded source expansion. Raw
metadata row allocation retains the CIL parser's existing one-million-row cap;
per-table preallocation control, streaming metadata, fuzz qualification and
platform/engine matrices are not claimed. All embedded size declarations are
charged before any CDI projection; actual decoded length still goes through
the existing inflater's declared-size and output limits.

One combined affected suite passed 106/106 tests; the exact parent separately
passed its 10 new tests. The old parent ignored the new method budget and failed
the retained expected missing-exception assertion. Syntax/static checks passed
3410/3406 modules with zero errors, manifests covered 896 Node files/37 browser
scripts/30 areas with no missing/duplicate assignments, and structure reported
271 inherited findings, none in owned paths. `qualification.txt` retains output.

The combined #4397/#4417 batch used one candidate install, with own
symbols links for each revision and reused dependencies only after matching
their Git tree/manifest hashes. It ran #4397's ten tests on its exact source,
then one affected suite on #4417. `comparison.mjs.txt` specifies the single fixed
20-round three-revision schedule for parse/load controls, retaining all 120
chronological samples and exact revisions/fixture hashes. The shared raw report,
configuration and browser results are retained once in
[`../portable-pdb-references/qualification`](../portable-pdb-references/qualification).

`browser.py <repository> <output-directory>` runs one shared Chromium, Firefox
and WebKit round, sequentially. Its sibling module reuses the already retained
scope/import/annotation/slot qualification and adds reference/budget boundaries.
The runner records each failed engine before rethrowing and closes every browser
and server. All 13 groups passed on Chromium 153.0.8010.12, Firefox 155.0 and
WebKit 26.6, macOS 26.6 arm64 / Python 3.14.7 / pinned Playwright 1.63.0. No
Windows/Linux, VM, CLR execution or Wasm coverage is implied. All local processes
and browser/server handles terminated before publication.

## Performance disposition

The fixed comparison's parent→budget parse median/p95 was
0.3585678125/0.38549104 → 0.3800894775/0.429474585 ms:
+0.021521665 ms/+6.002% median and +0.043983545 ms/+11.410% p95.
Cumulative baseline→budget parse costs were +8.287%/+13.683%.
Bound-load parent→budget median/p95 changed +0.264%/+1.949%; cumulative bound
load changed +3.540%/+2.551%. No sample was excluded and no repeat was run.

Root reviewer explicitly signed off both parse comparisons: all CDI occurrences
and declared expanded-source bytes are counted before copying/inflation, with
lowerable row caps; there are no new metadata snapshots or identity caches.
The measured cost is accepted for this bounded-work correctness feature.
No causal host-noise explanation, speedup, significance, allocation-improvement
or measured peak-memory claim is made. All 120 raw samples remain available.
