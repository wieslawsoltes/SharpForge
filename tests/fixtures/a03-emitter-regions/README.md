# Nested source emitter reference evidence

Four C# inputs exercise try-in-finally, finally-in-catch, three-level nesting and
nested rethrow through the portable source-image CIL emitter. Candidate product
`692dcf70d773db48a01c64b6a0a1f650d008c4e3` passes 323 focused tests, including
source VM and canonical CIL reload. The unchanged source tests on exact parent
`b6c4d52a81d26c0fca5ae17f42cdf08703d7e04f` fail three cases with "Nested clauses
must precede enclosing clauses"; [baseline-red.txt](baseline-red.txt) retains
that original output. The fourth (nested rethrow) already passes on the parent.

[native.json](native.json) records four ILVerify 10.0.5 acceptances (exactly one
entry method each) and CoreCLR 10.0.5 executions with expected stdout and exit 0.
SDK 10.0.201, checked tool bytes and the 167-assembly reference-pack digest are
pinned by existing oracle helpers. The capture records source and assembly hashes,
raw decisions/execution output, and validates all observations before succeeding.
It does not establish browser, Rust or broader platform qualification.

```sh
node scripts/limited.js node tests/fixtures/a03-emitter-regions/capture.mjs /tmp/emitter-regions-native.json
```

Set the tool environment from `tests/conformance/verifier/README.md`. Local
qualification ran through one limiter-owned serial driver (both concurrency
limits 1), stopping at the first unexpected result. The initial driver's red-log
assertion expected the diagnostic code, which Node's assertion reporter omitted;
the retained messages confirmed the exact expected failure and the driver resumed
at native capture without repeating the baseline tests. Focused files were both
new emitter files, EH regions/encoding/placement/branches/leave, cil, managed-il,
compiler-exception-handling and compiler-differential-direct-cil. Required checks
passed: 3,126 syntax modules, 3,122 static-import modules, no errors; structure
reported 268 pre-existing findings and none in changed files.

[performance.json](performance.json) retains every chronological sample from the
same harness on exact parent then candidate: two warmups, seven measured emissions
per case, compilation outside timing and explicit GC before each sample. Node
24.21.0, Apple M3 Pro/Mac15,6, macOS arm64, sole scheduled team job on a shared host.
Heap deltas are sampled growth, not allocation counts or retained memory.

| Case | Parent median / p95 ms | Candidate median / p95 ms |
| --- | --- | --- |
| No handlers | 1.313250 / 6.445875 | 1.680667 / 4.074125 |
| Flat catch | 0.755708 / 0.800833 | 0.808416 / 1.158084 |
| Try in finally | 0.774083 / 1.187834 | 0.834333 / 0.844458 |
| Finally in catch | 0.719375 / 0.842250 | 0.735542 / 0.850750 |
| Three levels | 0.690250 / 0.767875 | 0.767709 / 0.834916 |
| Nested rethrow | 0.648500 / 0.809667 | 0.791541 / 1.047583 |

The no-handler median increased 0.367417 ms (27.98%); flat-catch median/p95
increased 0.052708/0.357251 ms (6.97%/44.61%). These are observed costs, not a
causal or statistical conclusion. Baseline nested outputs contain the ordering
defect; those measurements do not compare two correct implementations. All
controls and shared-host uncertainty are retained, with no speedup claim.
Root integration review explicitly accepted these quantified costs: three
previously invalid nested outputs are corrected with four-case native evidence,
and repeated zone/sibling scans become bounded validated geometry. The no-handler
path already avoids region/index construction. No tuning rerun was requested.
