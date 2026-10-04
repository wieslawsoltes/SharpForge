# Symbol parse budgets

Implementation draft for #2544, stacked on #4397 at
`9614e374bc96a1d6d4dabba34b394717d315e5b6`. The reference preflight and
SymbolError binary boundary are reused; no new CIL parser is introduced.
No install, tests, native build, benchmark, checks or browser run has occurred
for this branch. Validation waits for the root's sole serial slot.

Prepared tests cover each budget at the exact boundary and limit+1, plus
zero-byte CDI records, repeated handles, compressed/stored source sizes,
preflight before malformed inflation, invalid options, existing file/per-source
caps, cancellation and retained Roslyn corpora. No native rebuild is planned.

The new object controls symbol projection and decoded source expansion. Raw
metadata row allocation retains the CIL parser's existing one-million-row cap;
per-table preallocation control, streaming metadata, fuzz qualification and
platform/engine matrices are not claimed. All embedded size declarations are
charged before any CDI projection; actual decoded length still goes through
the existing inflater's declared-size and output limits.

Performance measurements, affected Node contracts, shared browser smoke and
required checks are pending. No throughput or allocation improvement claim.

The scheduled combined #4397/#4417 batch uses one candidate install, with own
symbols links for each revision and reused dependencies only after matching
their Git tree/manifest hashes. It runs #4397's ten tests on its exact source,
then one affected suite on #4417. `comparison.mjs.txt` specifies a single fixed
20-round three-revision schedule for parse/load controls, retaining all 120
chronological samples and exact revisions/fixture hashes. No native rebuild.

`browser.py <repository> <output-directory>` runs one shared Chromium, Firefox
and WebKit round, sequentially. Its sibling module reuses the already retained
scope/import/annotation/slot qualification and adds reference/budget boundaries.
The runner records each failed engine before rethrowing and closes every browser
and server. The planned command uses the existing pinned Playwright environment;
neither this runner nor the prepared Node comparison has been executed yet.
