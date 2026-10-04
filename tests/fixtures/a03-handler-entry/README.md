# Try-entry admission evidence

Product revision: `c8240e1e` on base `b577947d`. Old-product regression revision:
`f3afbf33` (tests-first, no extraction or entry enforcement). Serial local run on
Apple M3 Pro, macOS 26.6 arm64, Node 24.21.0, shared machine. Node heap capped at
1 GiB; `SHARPFORGE_TEST_CONCURRENCY=1` and `SHARPFORGE_MAX_PARALLEL_RUNS=1`.
Every child ran sequentially under one `node scripts/limited.js` reservation.

- Old product failed the expected admission assertion: expected false, actual
  true. Complete output is [baseline-red.txt](baseline-red.txt).
- Corrected [native.json](native.json): fifteen authored PE cases against pinned
  ILVerify 10.0.5, .NET SDK 10.0.201/runtime 10.0.5. All agree; every negative has
  TryNonEmptyStack. Each method was verified (not executed). Input source and
  assembly hashes are checked by the focused tests.
- [native-mismatches.json](native-mismatches.json) retains every observation from
  three stopped attempts. The initial draft wrongly rejected a coincident catch
  seed; the next drafts wrongly rejected matching internal and same-catch
  backwards branches. Native accepted each. Expectations and code changed
  together; these failures are not presented as passing attempts.
- Eight new tests plus affected admission, stack-proof, prefix, calli and source
  emitter tests: **167 passed, zero failed/skipped/cancelled** across 12 files.
- `npm run check`: 3,289 syntax modules / 3,285 import modules, zero errors;
  manifest 851 Node files, 36 browser scripts, 30 areas, no unassigned/duplicates.
- Structure command exited zero and reported 271 existing warnings. No new
  helper or benchmark warning. Execution-profile's pre-existing max line length
  remains 466; extraction reduces the frozen module's size and line count.

The final pipeline ran capture, focused tests, fixed benchmark, static check,
then structure check; it stopped on each earlier native mismatch. It did not
repeat completed installs or the successful old-product regression. Commands:

```sh
node tests/fixtures/a03-handler-entry/capture.mjs OUTPUT.json
node --test --test-concurrency=1 tests/a03-07-handler-entry.test.js \
  tests/managed-il.test.js tests/a05-09-verified-stack.test.js \
  tests/a05-cil-stack-byte-budget.test.js tests/a05-managed-calli.test.js \
  tests/a05-calli-stack-byte-budget.test.js tests/a03-08-prefix-array-address.test.js \
  tests/a03-08-prefix-memory.test.js tests/a03-08-prefix-constrained.test.js \
  tests/a03-08-prefix-tail.test.js tests/a03-06-emitter-regions-source.test.js \
  tests/a03-06-emitter-regions.test.js
node packages/cil/tools/benchmark-handler-entry.mjs OUTPUT.json
npm run check
node scripts/quality/check-structure.js
```

## Existing admission controls

[benchmark.json](benchmark.json) retains all 40 processes from a fixed 20-pair
AB/BA schedule; none were excluded or rerun. Each process used 12 chronological
samples of 1,000 admissions per mode, with the first three designated warmup
before measurement. Table entries are medians of the 20 process medians and
p95s, in milliseconds per 1,000 admissions. The baseline runs its own source and
node_modules at f3afbf33; candidate runs c8240e1e. The same harness is copied to
baseline, and emitted fixture hashes match across every process.

| Control | Baseline median / p95 | Candidate median / p95 |
|---|---:|---:|
| No handlers | 3.512688 / 4.714458 | 3.512438 / 5.266375 |
| Catch | 5.512271 / 7.064937 | 5.321667 / 6.707855 |
| Finally | 4.588604 / 7.718834 | 4.100959 / 5.648625 |

**Root integration sign-off:** accept the no-handler p95 increase of 11.7069%
(+0.551917 ms per 1,000 admissions, about 0.552 microseconds per admission).
Median changes by -0.0071%. This bounded correctness check adds an extracted
helper call/result per method and prevents previously admitted nonempty try
entries. Usual zero-height entry checks allocate no candidate map; exception-seeded
cases allocate at most one candidate per distinct try start. No allocation/peak
memory measurement was performed. Shared-host results do not prove causation,
noise or a speedup; no repeat was selected to improve the result. Catch/finally
controls have no measured regression above the contribution budget.

Typed verifier, general EH transfers, filter execution and broad platform/engine
qualification remain open under #2407. See the [public contract](../../../packages/cil/VERIFIER-HANDLER-ENTRY.md).
