# Readonly array Address reference plan

Seven ordinary-CIL methods cover multidimensional, vector, callvirt and reference
array Address calls, a readonly Get rejection and the remaining readonly-store
limitation. Capture retains actual pinned ILVerify 10.0.5 decisions without
assuming agreement or running method bodies. SDK 10.0.201 / reference pack 10.0.5
and the existing checked external tools are reused.

Captured with pinned ILVerify 10.0.5. To reproduce in a scheduled exclusive slot,
use the tool environment
from `tests/conformance/verifier/README.md`:

```sh
node scripts/limited.js node tests/fixtures/a03-prefix-array-address/capture.mjs /tmp/array-address-native.json
```

The focused suite covers exact signature matching, unsupported shapes, malformed
metadata, budgets, per-invocation reuse, changed metadata on subsequent calls,
Buffer ownership and cancellation. Native execution, source VM, browser and Rust
qualification are not claimed by this metadata-recognition service.

The prepared benchmark takes an output JSON path and `control` or `address` mode:
`node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-prefix-array-address.mjs /tmp/array-address-performance.json address`.
Run the same `control` harness on exact parent 1db2e1d5 and the candidate to measure
the existing constrained-prefix path. Address mode measures the new cached path.
All chronological samples are retained in `performance.json`; the parent checkout
used the identical harness and fixture with unchanged parent product source.

`native.json` records five accepting Address cases and the rejecting readonly Get
case agreeing with ILVerify. ReadonlyStore still passes this lexical service while
ILVerify rejects it with ReadOnlyIllegalWrite. No method bodies were executed.
The new and affected prefix/opcode/CIL suites passed 222/222 tests.

Timing median/p95 (ms), parent → candidate for the existing constrained control:
1,000 groups 0.743584/0.876208 → 0.777208/0.889625;
5,000 groups 2.083084/2.741750 → 2.650459/2.812333.
The 5,000-group median rose 0.567375 ms (+27.24%); p95 rose 0.070583 ms (+2.57%).
The new cached Address path measured 0.788209/0.986584 ms for 1,000 and
1.610083/2.724375 ms for 5,000 groups; its instruction sizes differ from the control,
so these are not speedup comparisons. Node 24.21.0, Apple M3 Pro, macOS arm64;
sole scheduled team job on a shared host. No statistical significance, allocation
or RSS claim. Root integration review explicitly accepted the quantified control
increase: lazy state threading enables valid readonly Address operations without
metadata/cache allocation on the constrained/ldelema path, in an opt-in bounded
preexecution validator. No benchmark rerun or causal noise claim was used.

Required checks completed: 3,089 syntax modules / 3,085 static modules, zero
errors. Structure reported 268 existing repository findings, none in this slice.
