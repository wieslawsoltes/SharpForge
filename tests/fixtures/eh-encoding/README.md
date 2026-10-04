# Native exception-section reference

The Node capture emits six deterministic assemblies using the public CIL writer.
The offline .NET 10 oracle reads each exception region through SRM and invokes
`Cases.Run`: filter methods return 42; supported single-section nested fault/catch
methods return 7 only after the fault handler has run. Fat, small and auto encodings
are represented. A separate test-only chained image records the unsupported native
case: only the first EH section is read and NullReferenceException escapes. The
product rejects chained encoding explicitly. The JSON records exact assembly hashes, SDK/runtime versions and
oracle source hashes. No platform other than the actual capture host is qualified.

Capture command and pending status are documented in `packages/cil/EH-ENCODING.md`.
