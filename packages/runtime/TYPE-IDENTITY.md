# Assembly-aware runtime type identity

Method tables keep execution identity separate from display metadata. A linked
project type carries `assemblyKey` and `metadataName` alongside its opaque runtime
name. Two assemblies can define the same metadata name without sharing a table,
array element identity, static storage or reflected assembly provenance.

`MethodTableRegistry` remains the sole owner of resolved tables and tokens. A
per-registry trie is created only when a descriptor supplies an assembly key. It
recognizes already registered qualified names inside generic/array/byref syntax;
commas, angle brackets and square brackets in an assembly name are not reparsed as
type syntax. Unknown names do not gain admission merely by looking qualified.
The public runtimeTypeName/splitTypeArguments behavior for ordinary types remains
available through the existing method-table and runtime entry contracts.

Source table construction rejects an unresolved `externalReferences` property
before reading type descriptors. Bytecode validation admits pre-link references
for emission, while runtime construction requires a fully linked image before
program effects. The later graph loader is responsible for resolving the closed
set of supplied PEs and validating assembly identities, signatures and hashes.

Source vtables are indexed once by owner before table construction, avoiding a
method-array scan per type. CIL tables copy the same assembly/metadata provenance.
Reflection displays the original metadata name while retaining the exact assembly
identity; executable lookup continues to use the qualified identity.

Closed MemberRef field resolution preserves its already substituted storage
signature and generic owner. Only an open FieldDef derives that context from the
receiver's declaring table. Cache hits retain receiver/generation validation, and
the correction does not change field-cache keys or make a foreign receiver valid.
The full CLI fixture replaces an incomplete mocked inspector in existing tests;
all inherited-layout, indexed-membership and foreign-field assertions remain.

## Performance evidence and open review

The unchanged release14 workload was run serially through limited.js under
Node22.23.3 on Linux x86_64, pinned main b34fa27b against final c1a662d1, two
alternating pairs and eight warm samples per cell. These compare complete trees.
They do not isolate this projection. Values below are median milliseconds.

| Workload | Engine | Baseline | Final | Change |
| --- | --- | ---: | ---: | ---: |
| Dictionary | Source | 36.9236 | 40.8598 | +10.66% |
| Dictionary | CIL | 126.6231 | 170.1853 | +34.40% |
| List | Source | 52.8455 | 53.5260 | +1.29% |
| List | CIL | 368.3493 | 377.5246 | +2.49% |
| Queue | Source | 22.2536 | 23.2475 | +4.47% |
| Queue | CIL | 141.7445 | 153.6864 | +8.42% |
| StringBuilder | Source | 25.0697 | 23.5174 | -6.19% |
| StringBuilder | CIL | 66.4035 | 62.5392 | -5.82% |

All workload outputs matched. Managed allocation counters were equal; these are
not JavaScript heap-allocation measurements. The three changes above 5% require
performance review/sign-off. Shared-machine pressure and sample variation remain
caveats, not explanations for the regressions. The CIL dictionary slowdown occurs
in both pairs. Compilation and VM construction are outside the clock, and ordinary
workloads allocate no qualified-name trie. Repeated generic type normalization in
CIL calls is a concrete profiling candidate; causality is not established and no
speedup is claimed. Current captures, p95 values and source hashes are recorded in
the publication evidence, with raw samples retained by the integration owner.

A bounded CPU-sampling follow-up isolated four dictionary vm.run intervals after
one warmup, with compilation and VM construction excluded. Both trees remained
correct; integrated runCilSlice and runtimeTypeName inclusive samples were lower
than baseline. Instrumentation did not reproduce the uninstrumented regression
and cannot replace those benchmark results. No causal fix was established and no
speculative normalization/cache change was adopted. Performance sign-off remains
open.
