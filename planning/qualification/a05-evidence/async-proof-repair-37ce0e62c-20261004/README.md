# Async proof reconciliation repairs — 2026-10-04

The six-file focused batch at clean commit
`37ce0e62c2b0180764970b63f58b742d383fe0cb`, tree
`2ec8f359d3b66250425f999811f4100604349175`, completed **37 tests: 37 passed,
zero failed, zero skipped**, in 5166.376966 ms.

The tests cover corrected TaskAwaiter value-type metadata, task-owned OnCompleted
registration and replay, caller generic variables in the exact substituted async
signature, canonical intrinsic registry identity, strict runtime assembly and
MethodImpl rejection, callback collection roots, and Task aggregate construction.
The retained SDK8 Roslyn DLL is hash-checked against its original native capture;
its actual output and both same-machine await snapshots replay locally and in a
fresh VM. This run did not execute a new .NET process or the nine SDK10 native cases.

The initial wrapper attempt stopped before tests with `RUN_SLOT_LEGACY_STALE`.
The original output and journal remain separate from the successful TAP capture.
Read-only inspection then found the run-slot directory empty; no lock was removed,
no wrapper was bypassed, and the identical bounded command was retried.

The successful run used the repository limiter, one machine-wide run, one test
worker, a 512 MiB Node heap cap, and own-checkout `@sharpforge` links. Exact argv,
environment, revision/tree, input hashes, UTC timestamps, raw-output digest, and
clean tracked-file state are recorded in `focused-journal.json`. All four raw
payloads are retained byte-for-byte and listed in `manifest.json`.
