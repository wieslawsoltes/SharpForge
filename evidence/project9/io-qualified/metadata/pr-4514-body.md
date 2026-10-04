Task: SF-A09-T03.1

Make StringWriter return its current builder text through an object reference. For example, `object value = writer; value.ToString()` returns the written text instead of `System.IO.StringWriter`, including after disposal and subsequent builder mutations.

The product change marks the existing parameterless StringWriter.ToString contract as an Object.ToString override. ID 655380 is unchanged; GetStringBuilder remains 655379. Dispatch, null handling and CIL call-kind behavior reuse the framework override prerequisite merged in #3681. The framework test's exact opt-in list adds StringWriter alongside StringBuilder and Uri; the merged integration also retains Stopwatch, as recorded in the conflict resolution in `io-integration.json`. The A09 test manifest includes this coverage.

This scope is the Object.ToString override; it does not add `Write(object)` or `WriteLine(object)` overloads, a runtime dispatcher or a new formatting implementation. Primitive, Convert and Console profiles remain unchanged.

Pinned .NET 10.0.5 evidence contains ten actual call/callvirt cases: empty, written, disposed, mutated after disposal and null. Focused tests cover compiled source, direct CIL, profile round trips, independently assembled instructions, observer-triggered GC, snapshots, disposal faults and allocation failure. This resolves the object-reference ToString limitation documented on #4510 and #4513.

This is item 4 of 8, based on #4513 (`codex/a09-string-reader-buffer`); #4515 is its immediate child.

IO stack: #4509 → #4510 → #4513 → #4514 → #4515 → #4516 → #4517 → #4542.

The final integrated IO stack at `fe8288772be85395909d5de582c444db3d605ca3` passed an actual replay of all 278 integrated tests, with zero failures, cancellations, skips or todos. `io-final-replay-execution.json` records the exact argv, revision, tree, environment, 18 input-file hashes and exit status for `io-final-replay-tests.tap`. Benchmark, static-check, build and package-smoke qualification remains attributed to product revision `f8414bfcadbab039280d580a8152ac21f9fe6452`; only the README changed afterward. The non-strict structure command completed with 268 existing repository warnings. All 29 workspace packages installed offline without source workspace links and passed 45 package smoke steps. These results qualify the combined stack, not individual retests of this earlier PR head, and do not establish passing hosted IO CI.

Final timing, package/browser-size measurements and explicit budget decisions are scoped to the scalar follow-up #4542.

Raw evidence publication is pending on the planned branch `codex/project9-io-qualified-evidence`, under `evidence/project9/io-qualified/`, including `manifest.json` and `qualification-review.md`. This is a planned location, not a published archive. After verifying the evidence tree, the integration owner will replace this note with immutable links.

Merge remains blocked by the root lockfile prerequisite. At `fe8288772be85395909d5de582c444db3d605ca3`, `npm ci --ignore-scripts --no-audit --no-fund` failed with `EUSAGE` because `@sharpforge/bcl-io@0.14.0` is missing from the lockfile. The retained `io-clean-install-gate.json` and `io-clean-install-gate.log` record exit code 1 and an unchanged root lockfile. Four IO entries need integration: the workspace package, workspace link, framework dependency and runtime dependency. Offline tarball smoke results do not establish a clean source-checkout installation.

The live `package-json` lease remains owned by `codex-p19-core` / SF-A25-T01.1 (#2072). After an authorized release or handoff, integrate the narrow lockfile repair through the stack, preserving unrelated entries; then rerun clean installation, affected checks/build and required `core` at the resulting heads before merging in stack order. Lease expiry alone does not authorize takeover, and previously canceled checks do not establish merge readiness.

Issue #2723 remains open for unimplemented text IO, including provider/composite/object formatting, culture APIs, spans/memory, async methods, Null/Synchronized wrappers, Encoding and Console writer replacement. Scalar numeric writes are implemented by #4542, not by this earlier PR. Custom reader/writer subclasses, external `IDisposable.Dispose` CIL dispatch, OS-specific default-newline parity and Rust native/Wasm execution remain outside this qualified profile.
