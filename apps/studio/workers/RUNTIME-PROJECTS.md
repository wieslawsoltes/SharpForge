# Project graph runtime worker

The runtime `launch` request accepts an entry assembly and explicit
`dependencies: [{assembly, project, contextId}]` artifacts. Input normalization
removes an identical entry byte object, copies each supplied PE and checks count
and byte budgets before graph admission. Canonical loading validates every
supplied identity, hash and member binding, including unused supplied artifacts.

`createRuntimeExecutable()` caches one complete verified graph. Its key includes
all PE content and project/context provenance; a library change cannot reuse a
stale graph. A failed decode leaves the prior cache usable. Ordinary single-module
launches preserve their existing fast path and explicit managed-IL method options.
Arguments are session-specific overlays, independent of cached metadata.

`createRuntimeLaunchCandidate()` binds an entire source or direct CIL candidate
before the worker replaces its active session. A rejected assembly, argument or
breakpoint input preserves the existing paused/running session. Canonical
`programArguments` and `environment` retain precedence over the supported legacy
`args` and `environmentVariables` forms; working-directory aliases remain explicit.
No operating-system environment is inherited into managed environment reads.

`runtimeSourceRecords(session)` publishes only structured source records, retaining
assembly identity, original URI and project/context provenance. Metadata tables,
inspectors and buffers stay inside the worker. Graph Hot Reload and external PDB
replacement are rejected with `SF_RUNTIME_GRAPH_UPDATE`; relaunch supplies the
whole verified graph. Single-module update behavior remains available.

Nine existing cache/input/production-worker cases and the original source-record
assertion are preserved. Production-worker cases run the actual module in a Node
worker transport on both execution engines. This does not claim new protected
Studio application wiring or Rust native/Wasm execution. The related runtime
benchmark budget exceptions remain recorded for performance review.
