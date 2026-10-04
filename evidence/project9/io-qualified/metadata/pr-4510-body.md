Task: SF-A09-T03.1

Add synchronous StringWriter over the existing managed StringBuilder: default/builder constructors, NewLine, `Write(char/string)`, `WriteLine()`, `WriteLine(string)`, Flush, Close, Dispose, GetStringBuilder and ToString, with inherited abstract TextWriter metadata.

The supplied builder retains its identity and remains mutable after disposal. Subsequent writes throw ObjectDisposedException, including null/empty string writes; newline access, flushing and buffer access remain available. The implementation reuses StringBuilder storage, growth, notifications and the existing 1,000,000 UTF-16-unit host bound. Separate value/newline appends preserve completed text when the newline fails. Managed fields and scoped roots preserve GC and snapshot behavior.

Thirteen contracts append at A09 IDs 655368–655380, preserving JSON and reader IDs. This PR adds no compiler/VM routing or package-manifest changes. The existing LF execution profile supplies the default/reset newline; explicit newlines preserve UTF-16 exactly.

The pinned SDK 10.0.201/.NET 10.0.5 oracle and focused fixtures cover unchanged source programs, bound/legacy character writes, independent CIL UTF-16/base dispatch and faults, shared builder mutation, disposal, GC during notifications, snapshots and host bounds. Both method-body and top-level `using` exercise existing disposal paths through the merged compiler prerequisite.

This PR's original scope qualifies direct StringWriter.ToString calls. Child #4514 adds the Object.ToString override; #4542 subsequently corrects string-line disposal sequencing and adds scalar writes. Buffer and character-line overloads are separate children.

This is item 2 of 8, based on #4509 (`codex/a09-string-reader`); #4513 is its immediate child.

IO stack: #4509 → #4510 → #4513 → #4514 → #4515 → #4516 → #4517 → #4542.

The final integrated IO stack at `fe8288772be85395909d5de582c444db3d605ca3` passed an actual replay of all 278 integrated tests, with zero failures, cancellations, skips or todos. `io-final-replay-execution.json` records the exact argv, revision, tree, environment, 18 input-file hashes and exit status for `io-final-replay-tests.tap`. Benchmark, static-check, build and package-smoke qualification remains attributed to product revision `f8414bfcadbab039280d580a8152ac21f9fe6452`; only the README changed afterward. The non-strict structure command completed with 268 existing repository warnings. All 29 workspace packages installed offline without source workspace links and passed 45 package smoke steps. These results qualify the combined stack, not individual retests of this earlier PR head, and do not establish passing hosted IO CI.

Final timing, package/browser-size measurements and explicit budget decisions are scoped to the scalar follow-up #4542.

Raw evidence publication is pending on the planned branch `codex/project9-io-qualified-evidence`, under `evidence/project9/io-qualified/`, including `manifest.json` and `qualification-review.md`. This is a planned location, not a published archive. After verifying the evidence tree, the integration owner will replace this note with immutable links.

Merge remains blocked by the root lockfile prerequisite. At `fe8288772be85395909d5de582c444db3d605ca3`, `npm ci --ignore-scripts --no-audit --no-fund` failed with `EUSAGE` because `@sharpforge/bcl-io@0.14.0` is missing from the lockfile. The retained `io-clean-install-gate.json` and `io-clean-install-gate.log` record exit code 1 and an unchanged root lockfile. Four IO entries need integration: the workspace package, workspace link, framework dependency and runtime dependency. Offline tarball smoke results do not establish a clean source-checkout installation.

The live `package-json` lease remains owned by `codex-p19-core` / SF-A25-T01.1 (#2072). After an authorized release or handoff, integrate the narrow lockfile repair through the stack, preserving unrelated entries; then rerun clean installation, affected checks/build and required `core` at the resulting heads before merging in stack order. Lease expiry alone does not authorize takeover, and previously canceled checks do not establish merge readiness.

Issue #2723 remains open for unimplemented text IO, including provider/composite/object formatting, culture APIs, spans/memory, async methods, Null/Synchronized wrappers, Encoding and Console writer replacement. Scalar numeric writes are implemented by #4542, not by this earlier PR. Custom reader/writer subclasses, external `IDisposable.Dispose` CIL dispatch, OS-specific default-newline parity and Rust native/Wasm execution remain outside this qualified profile.
