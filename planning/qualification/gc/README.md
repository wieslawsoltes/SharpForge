# Deterministic collector comparison — SF-A29-T38

The harness records reachable sets from the actual JavaScript `ManagedHeap` after
explicit collections. Shared operation fixtures cover rooted/unrooted cycles,
strong/weak host handles, generation reuse, an empty heap, and a seeded graph.
IDs name allocations, not physical heap slots. Reachable and reclaimed sets are
sorted; wall-clock durations are excluded from comparisons. A uint32 seed and the
exact operation-fixture digest bind each trace.

```sh
node scripts/conformance/diff/gc-trace.js --seed 0
node scripts/conformance/diff/gc-trace.js --seed 1 --rust-trace path/to/actual-rust-trace.json
node scripts/conformance/diff/gc-trace.js --seed 1 --rust-trace path/to/actual-rust-trace.json --require-parity
```

No Rust collector implementation currently exists in this repository. The
harness therefore emits **unsupported**, without inventing a Rust trace or
claiming parity. `ManagedHeap` has no GC finalizer queue either: each JS fixture
records `finalization.status: unsupported` and `order: null`. Source VM exception
`finally` handlers are unrelated to GC finalization and are not used as a proxy.
Actual Rust execution, finalizer implementation, and platform qualification remain
open. Implementation does not close those acceptance obligations.

An independently captured Rust artifact must have the same schema, uint32 seed,
fixture digest, ordered fixture IDs and exact collection checkpoint steps as the
JS trace. It must identify `collector.engine: rust`, a collector version, its
source commit, and platform. Each checkpoint has `reachable`, `collected` and
`weak` observations. The adapter must drive the operations from
`scripts/conformance/diff/gc/fixtures.js` in its actual collector. Capture the
allocation IDs and clear weak targets after collection; never copy the JS results
as purported Rust observations. Replayed artifacts are provenance-labelled
inputs, not independently verified claims that the Rust executable ran here.

The comparator rejects missing checkpoints, wrong fixture/seed/source metadata,
unknown IDs, duplicate/unsorted sets, and invalid finalization records. It
classifies differences as reachable-set, reclamation-set, weak-reference-liveness,
or finalization-order. Any mismatch exits unsuccessfully. A match on reachable
sets with unavailable finalization is `partial`; `--require-parity` rejects both
partial and unsupported outcomes. When both real collectors support finalization,
ordered finalizer IDs are compared directly, with no reordering or suppression.

`artifacts/gc-trace/report.json` retains JS observations, supplied Rust input,
classified differences, unsupported axes and failures. The manually dispatched serial
workflow records seeds 0, 1 and 4294967295, and always uploads its report. Current
cross-platform qualification is unknown; a successful tooling process with
unsupported Rust is never a parity pass. Synthetic comparator inputs are confined
to unit tests and are never published as collector qualification.
