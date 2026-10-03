# Designer source qualification

The T12 corpus tests the public designer, compiler, syntax, text, and runtime package entry points together. It contains 51 independently stored C# fixtures: 49 accepted analyses and two malformed or non-design inputs that must be rejected without a source write. The corpus covers code-first documents, sibling partials, generated/read-only files, literal spelling, Unicode and CRLF trivia, styles, template factories, events, layouts, protected factory calls, dynamic expressions, and inline collection initializers.

## Reproduce the complete scope

Run from the repository root after installing the workspace packages:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a18-qualification-corpus.test.js tests/a18-qualification-fuzz.test.js tests/a18-qualification-report.test.js
node scripts/limited.js node examples/a18-qualification/report.mjs --evidence > designer-roundtrip-report.json
node scripts/limited.js node --expose-gc examples/a18-qualification/benchmark.mjs > designer-roundtrip-latency.json
```

The report includes the exact Git commit, whether tracked or untracked work was present, Node version, platform, architecture, and reproduction command. `tests/fixtures/a18/api-contract.json` pins the consumed public signatures and protocol semantics. Deterministic fixture data excludes environment fields and timings. The checked-in golden snapshots pin the analyzed source hashes, selected construction method, ownership classification counts, protected statements, diagnostic codes, complete design values, and source-to-design identity. Review a changed golden file as a behavior change; the normal test/report commands never rewrite it.

The explicit golden-update command is:

```sh
node examples/a18-qualification/report.mjs --record-goldens
```

The checked-in `examples/a18-qualification/designer-roundtrip-report.json` is the deterministic report for the reviewed corpus. After an intentional corpus change, regenerate it with the ordinary report command and review the diff. CI verifies that its fixture list, golden analyses, and engine counts agree with the corpus.

It first checks the separate handwritten acceptance expectations in `tests/fixtures/a18/corpus.json`. A changed compile result, unsupported-input classification, node set, or structural-editability contract cannot be accepted merely by recording a new snapshot. The resulting golden diff still requires review. These snapshots are regression references for this repository's public contract, not captured Microsoft WinUI or Roslyn reference results.

## Capability inventory

| Capability | Executable evidence | Boundary |
|---|---|---|
| No-op source preservation | Every accepted fixture calls `planDesignSourceUpdate` and requires identical UTF-8 source bytes and zero edits/files | Rejected input remains unchanged; it is never regenerated through a fallback |
| Minimal property edits | One existing literal expression, one file, and at most two removed/inserted lexer tokens | Protected expressions and read-only files return explicit ownership diagnostics |
| Source/design identity | Golden source binding names, declaration locations, design IDs, and an independent reread | A C# variable rename retains the existing design ID when the previous analysis is supplied |
| Runtime identity | Actual source-bytecode and direct-CIL execution, graph/type/property checks, unique runtime IDs, and a post-GC retention check | The runtimes are JavaScript implementations; their WinUI scene model is not native WinUI rendering |
| Structural editing | 1,000 independent seeds, each containing insert, move, delete, property updates, and additional seeded operations | Every final candidate is compiled, independently reread, and run on both JavaScript engines |
| Atomic failures | Malformed input, cancellation, disposal, exact size/node limits, and protected-factory structural rejection | Rejected work retains the previous source and preview |
| Deterministic report | Repeated representative report generation and a checked golden for every fixture | Exact opaque runtime handles are reported as observations, not used as cross-version public identifiers |
| Latency evidence | Fresh-process reads, warm reads, no-op plans, and scalar plans with median/p95/p99 | Empirical timings are machine-specific; retained heap deltas are not allocation counts |
| Allocation evidence | Separate V8 sampling heap-profiler passes estimate allocated bytes per warm operation, including collected objects | Sampling includes profiler overhead; it is not an exact object or allocation counter |

The first fuzz seed is `0x18c0ffee`; the next 999 unsigned integer seeds complete the batch. Failures print the decimal/hex seed and full operation sequence. Replay a failure directly:

```sh
node scripts/limited.js node examples/a18-qualification/replay.mjs 0x18c0ffee
```

Each sequence uses a fresh design document against an immutable source baseline. The independent reread deliberately receives neither a previous document nor identity hints. Child order and every property remain part of the comparison; only the incidental node declaration array order is canonicalized. Source compilation and both runtime executions use the emitted C#, not a fixture simulator or an alternate generator.

## Explicit target coverage

The report records `source` and `cil` separately. Qualified fixtures execute real `VirtualMachine` and `CilVirtualMachine` instances, activate a managed window, inspect the emitted scene, and collect the heap before verifying identity retention. Factories or incomplete compiler-profile forms that cannot establish an equivalent design/runtime graph are explicitly excluded from runtime qualification while their source preservation remains tested.

`browser` is unqualified here: this Node corpus does not inspect the DOM, accessibility tree, browser input, rendering, or GPU output. `nativeWinUI` is unavailable without a Windows App SDK/WinUI host and a native reference capture. `rustNative` and `rustWasm` are unqualified because these tests do not exercise Rust designer/WinUI host adapters. A skipped or unavailable target never contributes to a passing target count.

The applicable source-contract baseline is recorded in `corpus.json`; the runtime implementation, framework metadata, diagnostics, and generated code are versioned by the exact tested Git commit. Full browser and native visual qualification remains separate from T12's JavaScript source/identity evidence.

## Recorded local qualification

`examples/a18-qualification/qualification-evidence.json` records a clean detached checkout of commit `e328f265395f4d8b9ecd2d20252222d0bab0614e`: 81 passing tests, zero skips, all 1,000 randomized sequences, and separate source/CIL execution counts. The original command output and report are identified by SHA-256. This is local evidence; it does not substitute for the planning protocol's retained CI artifacts or native parity proofs.

`examples/a18-qualification/designer-roundtrip-latency.json` contains the measurements from that commit on Node v24.19.0, Linux x64, AMD EPYC 9V74. The input has six design nodes and 1,014 UTF-16 code units. Rounded times are shown below; the JSON retains full measurements and sampling details.

| Operation | Samples | Median | p95 | p99 | Estimated allocated bytes per operation |
|---|---:|---:|---:|---:|---:|
| Cold semantic read | 11 fresh processes | 47.00 ms | 59.26 ms | 59.26 ms | Not sampled |
| Warm semantic read | 51 | 4.05 ms | 5.73 ms | 7.43 ms | 890,434 |
| Warm no-change plan | 51 | 0.45 ms | 0.63 ms | 1.27 ms | 121,044 |
| Warm scalar plan and compile | 51 | 3.83 ms | 5.97 ms | 6.51 ms | 993,038 |

Cold timing begins after module loading. Allocation estimates use separate 31-operation profiler passes and include collected objects and profiler overhead. These observations include shared-host noise, are not a before/after speedup comparison, and do not establish responsiveness for large documents or browser rendering.
