Task: SF-A09-T03.1

Add `StringWriter`/`TextWriter.Write(char[])` and `Write(char[], index, count)`. The contracts append at A09 IDs 655383–655384 after reader buffer slots, preserving all existing IDs.

Null whole-array writes do nothing even after disposal. Slice writes validate the buffer and range before checking disposal, including empty slices. Shared character-array validation preserves StringReader rules. Each nonempty write converts UTF-16 in bounded 4,096-unit host blocks and calls the existing StringBuilder append once, preserving NUL and isolated surrogates without per-character managed strings or retained caller buffers.

Conversion takes O(count) time and O(count) temporary host text. The existing one-million-unit host bound is checked before conversion. Host-observer exceptions may interrupt builder field updates; this API does not promise transactional rollback. Native parameter names are evidence only; ArgumentException.ParamName support is unchanged.

The .NET 10.0.5 snapshot contains 70 concrete/base-call cases with source hashes, exact input/output units and faults. Source bytecode and independently assembled CIL replay them; bound/legacy compiled calls use the registered-class conversion prerequisite merged in #3775. Additional coverage checks GC, snapshots, copied inputs, allocation limits, observer faults, IDs, registration order and package smoke counts.

This scope adds buffer writes only. #4516 adds buffer-line writes and #4517 adds character-line writes. Historical per-batch performance results apply to their original revisions; final integrated timing and size qualification is scoped to #4542.

This is item 5 of 8, based on #4514 (`codex/a09-string-writer-object`); #4516 is its immediate child.

IO stack: #4509 → #4510 → #4513 → #4514 → #4515 → #4516 → #4517 → #4542.

The final integrated IO stack at `fe8288772be85395909d5de582c444db3d605ca3` passed an actual replay of all 278 integrated tests, with zero failures, cancellations, skips or todos. `io-final-replay-execution.json` records the exact argv, revision, tree, environment, 18 input-file hashes and exit status for `io-final-replay-tests.tap`. Benchmark, static-check, build and package-smoke qualification remains attributed to product revision `f8414bfcadbab039280d580a8152ac21f9fe6452`; only the README changed afterward. The non-strict structure command completed with 268 existing repository warnings. All 29 workspace packages installed offline without source workspace links and passed 45 package smoke steps. These results qualify the combined stack, not individual retests of this earlier PR head, and do not establish passing hosted IO CI.

Final timing, package/browser-size measurements and explicit budget decisions are scoped to the scalar follow-up #4542.

Raw evidence publication is pending on the planned branch `codex/project9-io-qualified-evidence`, under `evidence/project9/io-qualified/`, including `manifest.json` and `qualification-review.md`. This is a planned location, not a published archive. After verifying the evidence tree, the integration owner will replace this note with immutable links.

Merge remains blocked by the root lockfile prerequisite. At `fe8288772be85395909d5de582c444db3d605ca3`, `npm ci --ignore-scripts --no-audit --no-fund` failed with `EUSAGE` because `@sharpforge/bcl-io@0.14.0` is missing from the lockfile. The retained `io-clean-install-gate.json` and `io-clean-install-gate.log` record exit code 1 and an unchanged root lockfile. Four IO entries need integration: the workspace package, workspace link, framework dependency and runtime dependency. Offline tarball smoke results do not establish a clean source-checkout installation.

The live `package-json` lease remains owned by `codex-p19-core` / SF-A25-T01.1 (#2072). After an authorized release or handoff, integrate the narrow lockfile repair through the stack, preserving unrelated entries; then rerun clean installation, affected checks/build and required `core` at the resulting heads before merging in stack order. Lease expiry alone does not authorize takeover, and previously canceled checks do not establish merge readiness.

Issue #2723 remains open for unimplemented text IO, including provider/composite/object formatting, culture APIs, spans/memory, async methods, Null/Synchronized wrappers, Encoding and Console writer replacement. Scalar numeric writes are implemented by #4542, not by this earlier PR. Custom reader/writer subclasses, external `IDisposable.Dispose` CIL dispatch, OS-specific default-newline parity and Rust native/Wasm execution remain outside this qualified profile.
