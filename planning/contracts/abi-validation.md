# A00 value, execution and metadata contracts: qualification

Tasks: #4 / T01, #7 / T04, #8 / T05; atomic leaves #1032–1038 and #1055–1069.
Baseline product tree: `7f0ca223d1b9a07725078260020019cfb276c241` (preserves the CI fix after audited `011f2bc3bdd84f8db82a928d117100017211ca78`).
Initial implementation commit: `5a7c68cdf2d516ee21826862e807e8af3d0f43e3`. The typed-lowering follow-up below is based on the integrated services/registry stack at `ff5403e`; its exact measured implementation commit is recorded in `typed-ir-benchmark.json`.
Scheduler integration: `e964ff7be8626bc8c7a0c6d4a33bd36cb9f769f1` cherry-picks `d387dd1af25b3b2d1f0832d507dc63415e88b8eb`, preserving this baseline's frame-root implementation while moving resumed-fault roots before the active-context skip. The strict CIL await-fault fixture first reproduced collection of the resumed exception and now passes. No other runtime/compiler dispatch was changed by this contract scope.

Toolchain: Node v24.21.0 (`/Users/wieslawsoltes/.nvm/versions/node/v24.21.0/bin/node`), rustc 1.90.0 (1159e78c4 2025-09-14), Cargo.lock pins 15 transitive Rust crates. Shell-default Node v16 is unsupported and was not used for qualification. Run with Node >=22 in CI.

Commands and outcomes after the complete scope was written:

- `node --test tests/a00-01-value-abi.test.js tests/a00-04-execution.test.js tests/a00-04-resumed-fault-roots.test.js tests/a00-05-metadata.test.js tests/a00-05-typed-ir.test.js`: 47 passed, zero failed/skipped. Includes typed source/CIL lowering, incompatible joins/calls/stores, malformed control flow, explicit unsupported operations, example coverage, floating widths and static version re-export checks.
- `node scripts/planning/schema/qualify-rust.js`: 90 independent native Rust schema-reader cases passed, including null/unconstrained typed-IR annotations and newer body-version rejection. This qualifies schema parsing, not managed native execution.
- `node scripts/planning/inventory-values.js --check`: source carrier inventory matched.
- `node scripts/planning/gen-schema-fixtures.js --check`: all 11 deterministic fixture files matched; the tests independently generate twice and compare byte-for-byte.
- `node scripts/planning/abi/check-versions.js`: public constants and supported versions matched; newer, unknown, and source-drift cases fail closed in tests.
- `node scripts/planning/abi/example.js`: runnable exact Int64/reference/negative-zero transfer passed.
- `node scripts/planning/abi/benchmark.js`: correctness-gated codec and both JS runtime forced-GC paths passed. Raw timing and allocation evidence is in abi-benchmark.json. Timings are observations, not machine-independent thresholds. Codec allocation counts cover output ArrayBuffers only; heapUsed delta is not exact object-allocation accounting. Runtime allocation counts come from ManagedHeap statistics; GC distributions report cold/warm median/p95/p99.

## Requirement map

| Issues | Artifact/evidence |
| --- | --- |
| 1032 | inventory-values.js + value-abi/current-js-inventory.json; original “all numerics are number” assumption corrected for current CIL BigInt/float carriers |
| 1033 | value-abi.md + value-abi.schema.json + scalar-boundaries golden bytes; exact widths, decimal coefficient, char surrogate, NaN/-0 |
| 1034 | handle-abi.md H1–H8 + leases, stale and string-identity fixtures; issuer/epoch ownership and disposal checks |
| 1035 | fault-abi.md + fault schema/adapter; both VM catchable/budget/nested-finally records |
| 1036 | abi/value-codec.js, no runtime dependency; bounded ArrayBuffer reader and typed failures |
| 1037 | fixtures/value-abi + planning/contracts/tests/value-abi.test.js; million-element compact expansion with committed SHA-256, all smaller positive cases with committed byte hex |
| 1038 | versions.json + check-versions.js + source-constant mutation test |
| 1055 | gc-roots.md + recursive check-root-providers.js; rejects new providers including extracted submodules |
| 1056 | numbered safepoint kinds; runner records observed kinds and rejects expected-but-unobserved kinds |
| 1057 | gc-barriers.md; reference-capable bytecode/CIL store-to-hook map, allocation publication and builtin copies |
| 1058 | exception-dispatch.md; actual nested finally/rethrow/await-fault cases and host completion errors; unsupported filters/two-pass native semantics explicit |
| 1059 | host-operations.md; actual pending/complete/cancel/dispose/late-completion and host-revision tests |
| 1060 | pause-snapshot.md + capture projection schema; both real VM snapshots, owner and stable identity checks |
| 1061 | fixtures/safepoint/*.cs + run-safepoint-fixtures.js; all 14 real source/CIL paths force GC, preserve parked/native-callback/cancellation roots, and fail on a missing object |
| 1062 | bytecode-image.v1 schema; 62 independently emitted examples validated, 72 nonemitting inputs recorded in example-schema-coverage.json; verifier-only semantic checks enumerated |
| 1063 | type-identity schema; 40 representative golden types/signatures plus every registered canonical framework type |
| 1064 | symbol-id.md + SymbolTable; overload/generic/interface/local/lambda IDs and module-scoped metadata tokens |
| 1065 | source-span schema and adapter; emitted source points, UTF-16/CRLF boundaries and committed external Portable PDB |
| 1066 | method-body.schema.json + lower-method-body.js; 27 fully typed methods / 335 instructions from three programs in both VM representations; strict executable validation, region/branch offsets, call/local signatures and control-flow joins; positive, negative and boundary tests |
| 1067 | sf-metadata-stream.md + real PE includeDebug true/false checks |
| 1068 | schema/validate.js + independent native Rust schema reader; malformed, unsupported, newer-version and budget errors |
| 1069 | deterministic schema fixtures and regeneration checks |

## Typed lowering and qualification boundaries

The source and CIL adapters now normalize semantic operations and infer concrete instruction input/output and stack types from signatures, locals, resolved method/field/builtin metadata and control-flow joins. All three required programs, including generated helpers, are resolved: bytecode 8 methods / 125 instructions; CIL 19 methods / 210 instructions. `validateBody(body,{requireExecutable:true})` rejects unresolved, nonconcrete or inconsistent annotations. `schema/method-body.md` describes storage versus stack widths, source retained stores/void padding, handler entry stacks and explicit unsupported indirect-memory/calli/generic/filter/fault boundaries. No runtime/compiler hot files were changed for this lowering follow-up.

`node scripts/planning/schema/benchmark-lowering.js` measures source and CIL lowering independently after compilation, checking every iteration against strict executable validation and deterministic output. `typed-ir-benchmark.json` records cold/warm median/p95/p99 timings and exact output-instruction record counts. Temporary allocations and heap deltas are not exact allocator accounting; these observations are not platform-independent performance thresholds.

General two-pass filters/fault dispatch is specified but unsupported by the current executable VM subset. The barrier table defines future moving/generational collector obligations; it does not claim such collectors are present. Snapshot schema covers a portable inspection projection, not serialized native restore.

Node tests qualify actual source and CIL JavaScript interpreters. Browser, Wasm, Rust managed-runtime execution, native callbacks through FFI, and real worker termination remain unqualified. JS HostOperations callbacks are labeled as JS host boundaries. A canceled operation whose producer ignores abort may still complete successfully; disposal suppresses late completion. This existing behavior is recorded and tested, not hidden behind a stronger cancellation claim.

The example audit compiles files individually, preserving diagnostics for negative examples and project-only fragments. It does not claim that rejected fragments are independently executable projects. Golden/source-root inventories are extraction-sensitive: after integrating A05 modules, review and regenerate only after confirming their roots and schema meanings remain correct.
