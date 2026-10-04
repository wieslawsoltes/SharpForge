# Readonly array Address reference plan

Seven ordinary-CIL methods cover multidimensional, vector, callvirt and reference
array Address calls, a readonly Get rejection and the remaining readonly-store
limitation. Capture retains actual pinned ILVerify 10.0.5 decisions without
assuming agreement or running method bodies. SDK 10.0.201 / reference pack 10.0.5
and the existing checked external tools are reused.

Prepared, not run. At the scheduled exclusive slot, with the tool environment
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
Keep chronological samples and shared-host context; no result is claimed yet.
