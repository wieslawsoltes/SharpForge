# Combined managed-byref native qualification

`Program.cs` is byte-identical to the exported source in
`examples/runtime/managed-references.mjs`. The existing example and
`tests/a05-byref-call-scenarios.test.js` cover Swap with distinct and aliased
arguments, ref-returning indexers, an out write through a ref local, collection
while the alias is live, an out local, an in-struct defensive copy, and an
out-of-range indexer. `expected.txt` is the same authored trace, not a native
capture. A fixture identity regression rejects any divergence between the two.

The native plan runs this case for SDK8 and SDK10 on every configured OS:

```sh
node scripts/validate-a05-type-system.js \
  --fixture tests/fixtures/a05/byref-calls --source-routes \
  --framework net8.0 --output artifacts/a05-byref-calls
```

The runner compiles the unchanged source with the selected native SDK, executes
that DLL with .NET and CilVirtualMachine, and compares native stdout with the
authored trace. It then compiles the exact same source with SharpForge and
compares source, emitted-CIL reload, and direct CIL results against the actual
native process output and exit code. No native mismatch becomes an expected
value. Source/compiler diagnostics or any engine divergence fail the case.

A separate probe uses the exact fixture runtime configuration and host invocation
to record selected runtime identity, `IntPtr.Size` and process architecture.
Both the Roslyn CIL VM and all compiler-generated routes use that observed native
pointer width. Reports retain source/assembly hashes, native commands and results,
the probe, and each execution route's output, exit code and instruction count.
Unit tests simulate the report input and are explicitly not native evidence.
