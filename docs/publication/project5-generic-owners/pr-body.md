## Problem and change

Generated metadata names such as `<Keep>d__0`1` were truncated by generic display parsing. Nested generated types can also own GenericParam rows without adding their own backtick arity. Valid callback and storage identities were consequently rejected or given the wrong MethodTable arity.

This batch parses only a trailing instantiated argument list, retains complete opaque metadata names, and builds one inspector-owned inventory from authoritative GenericParam owner tokens. Runtime MethodTables use that inventory and preserve closed field substitution. Existing local identity, wrong-arity, VAR bounds and unsupported aggregate boundaries remain checked.

## Validation

- Original focused baseline: **2/22 passed, 20 failed** at `15260a49b152bbf3e61d9899254d9fcf1eebdd94`; retained unchanged.
- Original candidate: **55/56**; the existing generic-dispatch T03 wording assertion failed. Its raw failure is retained.
- Current-main integration: **56/56 passed**, no skips/cancellations, at `5d73d386a5516be6dd808ff7386a92b297e667e5`. All 753 exported files, 736 imported modules and eleven aliases are accounted for. Child 3.181824 seconds; limiter/startup 0.187478 seconds.
- Before correcting that old assertion, an unchanged-main probe returned the exact IL_TOKEN constrained-forwarder diagnostic. The updated assertion explicitly requires rejection and that message; its fixture and external-member negative assertion are unchanged.
- The paired benchmark replays the four previously captured genuine completed/suspended images and an ordinary control. Both revisions match retained expected output. This batch did not regenerate native output or execute browser/Rust/Wasm tests.

Exact commands, full outputs, source snapshots and SHA-256 inventories are in `docs/evidence/project5-generic-owner-publication/` and `docs/evidence/project5-generic-owner-performance/`.

## Performance and explicit cost acceptance

One A/B/B/A run used 80 warmups and 24 samples per round (48 measured samples per revision/case), Node v24.19.0 on shared Linux x86_64 with nine CPUs, through the normal limiter. The original six-file production comparison is `15260a49b152bbf3e61d9899254d9fcf1eebdd94` to `1db5d0255bd34db0c9349d829e2f6d213e96a878`; the shared runner is `67012fc903c7be05158efbe025e8c39c48a44da5`.

Recorded launcher: `python3 /workspace/scratch/1692a10afba9/cil-generic-publication-performance/run.py generic-names`. Its archived plan gives every nested command, pin and timeout.

| Workload | Total median before → after (ms) | Change | Total p95 before → after (ms) |
| --- | ---: | ---: | ---: |
| ordinary-no-async | 3.225499 → 3.260040 | +1.071% | 4.738974 → 4.694068 |
| Completed-Debug | 10.800539 → 7.445295 | -31.066% | 19.485839 → 11.035964 |
| Completed-Release | 10.369546 → 9.374790 | -9.593% | 14.971948 → 12.618320 |
| Suspended-Debug | 6.394770 → 5.195348 | -18.756% | 10.900606 → 9.891663 |
| Suspended-Release | 5.309211 → 6.345844 | +19.525% | 9.372069 → 9.132408 |

All breaches above 5% are explicitly accepted by the Project #5 implementation owner for correct generated-owner identity and authoritative arity:

| Workload | Metric | Statistic | Before → after (ms) | Change |
| --- | --- | --- | ---: | ---: |
| Suspended-Release | admissionMs | median | 2.549405 → 3.168175 | +24.271% |
| Suspended-Release | admissionMs | p95 | 4.878778 → 5.782366 | +18.521% |
| Suspended-Release | executionMs | median | 2.749424 → 3.245504 | +18.043% |
| Suspended-Release | totalMs | median | 5.309211 → 6.345844 | +19.525% |

This is quantified correctness-cost sign-off, not a performance-budget pass. Managed allocation counts and charged bytes are identical in every comparable case. JavaScript allocations and build output size were not measured. No rerun or threshold adjustment was used to improve the numbers.

## Scope

Refs #610 and #645. This completes the generated-name/arity batch; broader async payloads, waiting-boundary restore and additional async families remain in the project. Shared source-VM MethodTable normalization is covered by the table controls; separate source-VM execution and Rust/Wasm qualification remain pending. Hosted `core` remains the merge gate; the focused Node result above was executed separately.
