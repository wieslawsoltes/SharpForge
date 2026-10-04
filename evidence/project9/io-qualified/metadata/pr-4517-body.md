Task: SF-A09-T03.1

Add `StringWriter`/`TextWriter.WriteLine(char)` at appended A09 contract 655387. It writes one UTF-16 code unit through the existing character path, then rechecks disposal and appends the current newline. Completed character output remains visible if disposal, allocation failure or the host text limit prevents the newline.

The change reuses character conversion, StringBuilder append and the newline helper. Null/disposed validation retains its ordering; NUL and lone surrogates remain exact UTF-16 units. Existing IDs and `Write(char)`'s single disposal check are preserved. This PR does not change the string-line path; #4542 subsequently corrects its disposal boundary.

The frozen SDK 10.0.201/.NET 10.0.5 capture contains 40 concrete/base-view cases and four native-only observations of NewLine mutation/disposal between character and newline writes. Focused coverage includes source platform calls, independent CIL, bound/legacy compiled base references, invalid host values, GC, snapshots, allocation limits, observer failures and partial progress. Native subclasses provide sequencing evidence only; they do not enable custom TextWriter subclasses.

The retained per-batch benchmark includes separate `Write(char) + WriteLine()` and combined `WriteLine(char)` cases alongside prior controls. Those historical measurements apply to their original revisions. Final integrated timing, allocation/write counts and size qualification are scoped to #4542.

This is item 7 of 8, based on #4516 (`codex/a09-string-writer-line-buffer`); scalar follow-up #4542 is its immediate child.

IO stack: #4509 → #4510 → #4513 → #4514 → #4515 → #4516 → #4517 → #4542.

The final integrated IO stack at `fe8288772be85395909d5de582c444db3d605ca3` passed an actual replay of all 278 integrated tests, with zero failures, cancellations, skips or todos. `io-final-replay-execution.json` records the exact argv, revision, tree, environment, 18 input-file hashes and exit status for `io-final-replay-tests.tap`. Benchmark, static-check, build and package-smoke qualification remains attributed to product revision `f8414bfcadbab039280d580a8152ac21f9fe6452`; only the README changed afterward. The non-strict structure command completed with 268 existing repository warnings. All 29 workspace packages installed offline without source workspace links and passed 45 package smoke steps. These results qualify the combined stack, not individual retests of this earlier PR head, and do not establish passing hosted IO CI.

Final timing, package/browser-size measurements and explicit budget decisions are scoped to the scalar follow-up #4542.

Raw evidence publication is pending on the planned branch `codex/project9-io-qualified-evidence`, under `evidence/project9/io-qualified/`, including `manifest.json` and `qualification-review.md`. This is a planned location, not a published archive. After verifying the evidence tree, the integration owner will replace this note with immutable links.

Merge remains blocked by the root lockfile prerequisite. At `fe8288772be85395909d5de582c444db3d605ca3`, `npm ci --ignore-scripts --no-audit --no-fund` failed with `EUSAGE` because `@sharpforge/bcl-io@0.14.0` is missing from the lockfile. The retained `io-clean-install-gate.json` and `io-clean-install-gate.log` record exit code 1 and an unchanged root lockfile. Four IO entries need integration: the workspace package, workspace link, framework dependency and runtime dependency. Offline tarball smoke results do not establish a clean source-checkout installation.

The live `package-json` lease remains owned by `codex-p19-core` / SF-A25-T01.1 (#2072). After an authorized release or handoff, integrate the narrow lockfile repair through the stack, preserving unrelated entries; then rerun clean installation, affected checks/build and required `core` at the resulting heads before merging in stack order. Lease expiry alone does not authorize takeover, and previously canceled checks do not establish merge readiness.

Issue #2723 remains open for unimplemented text IO, including provider/composite/object formatting, culture APIs, spans/memory, async methods, Null/Synchronized wrappers, Encoding and Console writer replacement. Scalar numeric writes are implemented by #4542, not by this earlier PR. Custom reader/writer subclasses, external `IDisposable.Dispose` CIL dispatch, OS-specific default-newline parity and Rust native/Wasm execution remain outside this qualified profile.
