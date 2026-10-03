# CIL field metadata and frame preparation

The integration introduced repeated generic field resolution on every instance-field access and a method-entry preparation call on every CIL instruction. This change caches immutable field metadata and its index per inspector, token and closed receiver MethodTable. Every access still validates its heap handle and obtains the current record. Inspector replacement creates a new cache; snapshots retain metadata but restore heap records independently. Resolved signatures and generic arguments are immutable.

Instruction dispatch now checks the current frame's `needsInitialization` flag before calling the existing preparation gate. Pending initialization still schedules or waits before advancing the target instruction, including direct scheduler/delegate entries, failures, recursive initialization and restored snapshots. Cast behavior and type-initialization policy are unchanged.

Implementation commit: `dbe9f50f648b1c44f05f773f0f50e6a3b3c92969`. Both performance comparisons measured this exact clean commit. The subsequent merge `a822f5d4feff82c810e1e7ab6aac4c8a5ee58f2e` incorporates the published integration parent's evidence and verified ancestry without changing the measured product code. The full correctness suite ran at that clean merge revision. This evidence is recorded afterward.

Both comparisons use the canonical A29 T07 harness at `5108268106ed9a6140198d2e2371019de57ff407`, with 20 alternating base/head process pairs per adapter, three warmups and one measured warm run per process. Each process also records a cold run. Compilation and VM construction occur before the timed `vm.run()`. Correctness is asserted for every run. Host: Apple M3 Pro, 11 logical CPUs, macOS arm64 (Darwin 25.6.0), Node 24.21.0. Root-agent heavy workloads were paused during the two sequential captures; this is not an isolated physical benchmark machine.

| Comparison | Workload | Base median / p95 ms | Repair median / p95 ms | Median change | Regression p | Gate |
|---|---|---:|---:|---:|---:|---|
|Integrated `a3093d4` → repair|A05/vm-cil|13.749 / 24.755|10.238 / 18.798|-25.5%|1.000|Pass|
|Integrated `a3093d4` → repair|A08/dictionary-cil|8.061 / 9.244|8.063 / 8.915|+0.0%|0.868|Pass|
|Original `defb7cc` → repair|A05/vm-cil|12.879 / 23.008|14.483 / 24.356|+12.5%|0.412|No significant regression detected|
|Original `defb7cc` → repair|A08/dictionary-cil|7.893 / 9.046|8.650 / 12.265|+9.6%|0.00129|**Regression**|

The gate uses a one-sided paired sign test, alpha 0.01, and a 5% relative threshold. Its p-value tests a slowdown, not the significance of a speedup. A nonsignificant result is not evidence of equivalence. The original-baseline comparison exits **1**, and its regression remains unwaived. The different distributions across sequential comparisons are retained; medians must be compared within each captured A/B run. This repair improves the observed integrated object workload but does not establish full recovery to the original baseline or approval of the remaining regression.

Managed allocation counts and bytes are unchanged in every side: 500 objects / 20,000 bytes for A05 and 9 objects / 16,656 bytes for the dictionary workload. A05 performs 10 collections per run; the dictionary workload performs none. Native allocations are unavailable. Per-sample Node heap deltas and managed pause counters are retained, but heap delta is not a native-allocation measurement.

Both complete reports are retained in [cil-repair-integration](cil-repair-integration/summary.md) and [cil-repair-original](cil-repair-original/summary.md). Each contains aggregate base/head data, comparison policy/results, command order and commit provenance, all 80 raw process reports consolidated by original artifact filename in `samples.json`, and all corresponding stderr streams in `stderr.json`. There are no omitted process reports or nonempty stderr streams. [provenance.json](provenance.json) records reproduction commands and exit codes.

Validation completed after the implementation:

- All **4,089 registered tests passed**, with zero failures, cancellations, skips or TODOs; [full.log](full.log).
- All 374 A05 and ABI checks passed, including new generic FieldDef/MemberRef partitioning, null/stale/foreign receiver rejection, immutable metadata, current-record lookup after snapshot restore, reused tokens after inspector replacement, and initialization snapshots; [correctness.log](correctness.log).
- Syntax and ownership checks passed for 636 modules, with zero syntax errors, unassigned tests or duplicate owners. The production build passed; [build.log](build.log).
- The advisory structure check returned zero with inherited oversized-file findings; [structure.log](structure.log). The new field-cache module stays within its limits. An independent read-only review found no cache invalidation, handle-lifetime or initialization blocker.

The earlier source-dictionary regression is unchanged and remains explicit in the parent [integration report](../integration-performance/README.md). Source execution, compute and editor adapters were not rerun because this repair does not modify their execution paths. Source contract result enum classification remains a separate attribution task; it was not removed or weakened speculatively. No native Rust, Wasm-runtime or CLR performance qualification is claimed by these JS CIL measurements.
