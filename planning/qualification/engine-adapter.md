# Differential engine adapter protocol v1

A29 T04 executes a corpus through source VM, CIL VM, SharpForge's emitted DLL on
native CoreCLR, and the Roslyn reference DLL on that same pinned CoreCLR. The CIL
VM and native CLR receive identical DLL bytes, verified by SHA-256 before labeling
a mismatch as a runtime difference. Roslyn versus SharpForge DLL behavior is a
compiler difference. Managed faults preserve exception types/messages. Transport,
limits and cancellation failures are host differences. Same-seed repeat drift is
fixture-nondeterminism; unexplained mismatches fail as unclassified.

The adapters return `engine`, `status`, `phase`, `stdout`, `stderr`, `exitCode`,
`exception`, `diagnostics`, `artifactHash` and separate metrics. Status is
completed, compile-error, runtime-error, host-error, cancelled, budget-exceeded
or unsupported. Completed means an observation exists, not that parity passed.
An exception is `{type,message}`. Native exit statuses are normalized with actual
Windows DWORD/POSIX low-byte rules; exception exits have no comparable numeric
status. Timing, tool provenance, allocator counters and raw stack traces are not
compared as language behavior. Compilation diagnostic comparison uses error IDs
and severities; raw diagnostics remain available for differing spans/messages.

Source/CIL use instruction, frame, heap, output and elapsed-time budgets and stop
VM host operations in `finally`. Both currently report stdin as unsupported.
Native processes use elapsed-time/output budgets and literal piped stdin; an
instruction budget cannot be enforced by this native reference adapter. Processes
are terminated then killed on cancellation/overflow, reaped before resolving, and
temporary assemblies/configs removed. The tool is for trusted conformance inputs;
it is not an OS sandbox for hostile native programs or spawned process trees.

## A27 native and Wasm transport

Until A27 supplies artifacts, rust-native and rust-wasm return unsupported and
never completed/pass. Configure `SHARPFORGE_RUST_NATIVE` with the native host binary;
configure both `SHARPFORGE_RUST_WASM` and `SHARPFORGE_RUST_WASM_HOST` for the module
and its native JSON host. Artifacts are hashed in the observations. The command is:

```
<host> --protocol sharpforge-differential-v1
<wasm-host> --module <module.wasm> --protocol sharpforge-differential-v1
```

One UTF-8 JSON request plus newline is piped on stdin:

```json
{"protocol":"sharpforge-differential-v1","engine":"rust-native","fixtureId":"hello","inputHash":"sha256","seed":1729,"entry":"Main","stdin":"","limits":{"timeoutMs":10000,"maxInstructions":1000000,"maxOutputBytes":65536,"maxFrames":128,"maxHeapBytes":16777216},"assemblyBase64":"PE bytes"}
```

The host emits exactly one JSON object and exits zero for a valid transport:

```json
{"protocol":"sharpforge-differential-v1","engine":"rust-native","inputHash":"same sha256","status":"completed","stdout":"42\n","stderr":"","exitCode":0,"exception":null}
```

Allowed response statuses are completed, runtime-error, budget-exceeded and
unsupported. Runtime-error uses a typed exception and null exitCode. Unknown
fields, wrong engine/hash/protocol and malformed output are host failures.
For Wasm the engine field is rust-wasm. A27 must enforce managed budgets, own its
module lifetime and close all guest resources before responding. Unit fixtures
for this transport do not qualify a Rust or Wasm runtime.
