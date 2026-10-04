# CIL admission performance proposal — source only

Publication baseline: `41ebd76987aa912659310d4015607f46110358ab`.
Publication candidate: `b0285acf9d21205870c7f45f7d8a2ee65f917f25`.
No benchmark has been executed from this packet.

## Workloads and existing machinery

1. Run the existing `packages/runtime/bench/cil-async.mjs` without a native-capture
   argument. Its byte-unchanged ordinary workload constructs a VM, executes its
   known 128-iteration arithmetic loop and checks the result 8,256. This retains
   the existing admission, execution, total-time and managed-allocation metrics.
2. Run the new `callback.mjs` from the exported runtime bench directory. Each
   invocation constructs a fresh VM whose entry does not reference the callback,
   then times admission and execution of that callback. The callback executes a
   finally handler and returns 42. Every observation checks original entry and
   callback stack proofs, the paused caller, the 20,000,000 execution budget,
   callback-scope cleanup and the result. Fresh construction keeps every measured
   callback on the previously unverified path.

Both workloads use `{virtualTime: true}`. The VM's default execution budget is
20,000,000 in both versions. Passing an explicit value above the static EH ceiling
would make the old callback reject, so it cannot provide a comparable baseline
timing. The separately qualified tests cover that explicit-budget correction.

The paired launcher imports the existing async benchmark's exact source-export,
source-verification, process-capture and summary functions. It does not change
their globals or thresholds. Both versions receive identical benchmark/fixture
bytes, exported runtime sources come directly from their pinned Git commits, and
every export is hashed before and after each child process.

## Fixed bounds and comparison

- Existing warmup/sample policy: 80 warmups and 24 recorded samples per process.
- Fixed process order A, B, B, A. Constructor and callback drivers each run once
  for each letter: eight serial Node processes total.
- Each side/workload therefore contributes 48 recorded samples; all raw samples
  and per-process output remain in the JSON report.
- At most 30 seconds per child and 120 seconds for the measured sequence.
- Each source export must be at most 32 MiB; reports at most 8 MiB.
- Require 256 MiB free before preparing exports and 128 MiB before each child.
- Report median and p95 changes, constructor/total timing, callback timing,
  managed allocation counts and exact PE identities. Zero allocation baselines
  receive no invented percentage change.
- Require every raw timing and managed allocation value, plus reported median
  and p95 values, to be numeric, finite and nonnegative. Missing, null or invalid
  measurements fail qualification; both workloads must retain all 24 samples
  per process under the fixed 80-warmup policy.
- The host is shared; retain per-process summaries and load averages. A result
  above the project's 5% timing budget requires explicit assessment. This packet
  does not promise a passing budget or authorize an automatic repeat.

## Scheduled command

Run from the publication worktree with all three pinned DOTNET variables:

```sh
node scripts/limited.js python3 \
  /workspace/scratch/1692a10afba9/cil-admission-budget-performance-proposal/paired.py \
  --repository /workspace/scratch/1692a10afba9/p5-cil-admission-budget \
  --baseline 41ebd76987aa912659310d4015607f46110358ab \
  --candidate b0285acf9d21205870c7f45f7d8a2ee65f917f25 \
  --output /workspace/scratch/1692a10afba9/cil-admission-budget-publication-performance.json
```

The outer limiter owns the shared heavy slot throughout both exports and all
eight serial child runs. The temporary directory contains only this task's exact
exports and is removed after the report and source inventories are retained.
