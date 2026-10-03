# Compiler/runtime integration measurements

The integration adds binder architecture, typed runtime behavior and cross-stack correctness fixes. This capture records their cost; it is not a passing performance qualification. Five median changes exceed the contribution guideline's 5% review threshold, and several build outputs exceed its 10% size threshold. Explicit performance review/sign-off remains outstanding. Runtime hot-path follow-up work is tracked on the stacked `codex/a05-runtime-perf` branch.

Measured product revisions are `defb7ccbe13dae9dfe9a67cc24281b2a0b5f9e99` (before binder/type-runtime integration) and `a3093d496861383e0b26b4aaab7dfced552251b9` (after correctness fixes and main's contribution guidelines). The fixed T07 harness is `5108268106ed9a6140198d2e2371019de57ff407` from PR2427. The external compiler adapter's original committed owner is `3ef11211775ac10e65415c69bdda1d5bf7d80575`; its exact two files are retained here.

Measurements ran on Apple M3 Pro, 11 logical CPUs, macOS kernel 25.6.0, arm64, Node 24.21.0. Each workload uses 20 alternating-order before/after pairs in separate processes, one retained warm sample per process after three warmups. No simultaneous full test/browser/native capture ran during these benchmarks. A cold sample is also retained. These are local microbenchmarks, not Linux/Windows, CLR or native-Rust measurements.

Times below are milliseconds. The T07 statistical gate reports four regressions; the 10K compile median also exceeds the simpler contribution guideline threshold even though its p-value does not cross the T07 significance cutoff.

| Workload | Before median | After median | Before p95 | After p95 | Median change |
| --- | ---: | ---: | ---: | ---: | ---: |
| A05/vm-source | 1.899 | 1.420 | 2.637 | 1.843 | -25.2% |
| A05/vm-cil | 8.489 | 12.124 | 21.153 | 25.212 | +42.8% |
| A08/dictionary-source | 1.471 | 1.764 | 1.847 | 2.277 | +19.9% |
| A08/dictionary-cil | 12.669 | 11.572 | 25.690 | 22.004 | -8.7% |
| A10/compute-scalar | 0.273 | 0.268 | 0.406 | 0.296 | -1.6% |
| A10/compute-wasm | 0.105 | 0.105 | 0.114 | 0.131 | -0.4% |
| A20/editor-index | 10.747 | 10.698 | 14.030 | 14.559 | -0.5% |
| A02/compile-1k | 11.053 | 14.004 | 12.731 | 16.628 | +26.7% |
| A02/compile-10k | 91.808 | 98.085 | 165.053 | 190.749 | +6.8% |
| A02/edit-10k | 10.780 | 23.733 | 12.689 | 27.196 | +120.2% |

The VM allocation workload remains 500 managed allocations, 20,000 allocated bytes and 10 collections in both engines/revisions. The dictionary workload remains 9 managed allocations, 16,656 bytes and no collections. Compiler and editor measurements retain Node heap deltas, which may be negative because of collection and are not total allocation counts. Native allocator instrumentation is unsupported.

Both revisions passed build/standalone generation and all 25 package smoke tests before byte counts were captured. Counts include existing distribution content; no files were removed to make the comparison smaller. Binder modules and their bundled copies account for substantial growth, including the new compiler package surface. The existing size-budget harness cannot discover the newer `separator` contribution schema, so `size/measure.mjs` uses each target checkout's own discovery modules and records exact sizes without claiming a budget pass.

| Output | Before bytes | After bytes | Change |
| --- | ---: | ---: | ---: |
| dist | 17,510,342 | 19,945,200 | +13.9% |
| standalone | 4,492,847 | 5,078,533 | +13.0% |
| worker:compiler.worker.js | 858,682 | 1,359,099 | +58.3% |
| package:@sharpforge/compiler | 27,058 | 195,390 | +622.1% |
| package:@sharpforge/runtime | 65,721 | 81,282 | +23.7% |

The retained `base.json` and `head.json` reports contain every timing and metric sample. Each group's `samples.json.artifacts` maps the original per-process JSON filenames referenced by `run.json` to their complete contents; all captured stderr files were empty. `run.json` preserves actual chronological order and original commands. Temporary checkout paths are historical locations, not prerequisites for reproduction. `provenance.json` seals retained files.

For a reproduction, check out the pinned harness in a clean worktree and these measured commits in the same repository. Keep the compiler adapter registry in a clean committed checkout. Substitute those absolute checkout paths below; do not run competing heavy workloads.

```sh
node "$HARNESS/scripts/conformance/perf/ab.js" --root "$REPO" --base defb7ccbe13dae9dfe9a67cc24281b2a0b5f9e99 --head a3093d496861383e0b26b4aaab7dfced552251b9 --pairs 20 --output "$OUT/runtime"
node "$HARNESS/scripts/conformance/perf/ab.js" --root "$REPO" --base defb7ccbe13dae9dfe9a67cc24281b2a0b5f9e99 --head a3093d496861383e0b26b4aaab7dfced552251b9 --pairs 20 --registry "$ADAPTER/registry.json" --adapters A02/compile-1k,A02/compile-10k,A02/edit-10k --output "$OUT/compiler"
# For each target checkout after npm ci:
npm run standalone
npm run test:packages
node "$EVIDENCE/size/measure.mjs" "$TARGET" "$OUT/sizes.json"
```

The unchanged main baseline reports 256 advisory structure findings across the combined open stacks (`structure.log`). No baseline refresh hides those findings. Product validation at the measured head passed 4,083 Node tests; prior product-identical head cd25ca7 also passed 30 browser core checks, 17 runtime browser checks and all 25 package smoke tests. This evidence does not mark any of the remaining Project4 scope complete.
