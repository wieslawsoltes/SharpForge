Task: SF-A09-T03.1

Adds synchronous `StringWriter` over the existing managed `StringBuilder`: default/builder constructors, `NewLine`, `Write(char/string)`, `WriteLine()`/`WriteLine(string)`, `Flush`, `Close`, `Dispose`, `GetStringBuilder`, and `ToString`, with inherited abstract `TextWriter` metadata.

The supplied builder retains its identity and remains mutable after disposal. Writes then throw `ObjectDisposedException`, including null/empty writes; newline access, flushing and buffer access remain available. The implementation reuses the public core module registry and StringBuilder's storage, growth, notifications and 1,000,000 UTF-16-unit host bound. Separate value/newline appends preserve partial progress when only the newline exceeds that bound. Managed fields and scoped roots preserve GC and snapshot behavior.

Stacked on the StringReader package prerequisite. Thirteen contracts append at A09 IDs 655368–655380, preserving JSON and reader IDs. No compiler/VM routing or package-manifest changes.

Serial validation of the integrated Reader/Writer/buffer scope passed 218 focused tests, `npm run check`, `npm run check:structure`, build, and the invoked IO package smoke. Core and IO tarballs installed offline in an isolated project and the IO smoke passed without workspace links. The checked-in oracle was captured with SDK 10.0.201/runtime 10.0.5; normal tests do not invoke .NET. Coverage includes the unchanged source fixture, bound/legacy character writes on both VMs, independent CIL UTF-16/base dispatch and faults, shared builder mutation, disposal, GC during write notifications, snapshots, host bounds and stable contracts.

The native source and oracle remain unchanged. Both semantic method-body and top-level `using` now exercise the existing disposal paths. The separate compiler prerequisite has merged; this IO change adds no compiler behavior.

```sh
node scripts/limited.js node --test tests/a09-string-reader.test.js tests/a09-string-writer.test.js
```

Partial progress toward #2723; it remains open. This batch uses the existing LF execution profile, including reset-to-default newline; explicit newlines preserve UTF-16 exactly. OS-specific CRLF defaults, numeric/formatting/culture/provider and buffer overloads, Encoding, Null/Synchronized wrappers, async APIs and Console writer replacement remain unregistered. Custom writer implementations, external `IDisposable.Dispose` CIL dispatch, and Rust native/Wasm execution remain outside the qualified profile. New writes inherit StringBuilder's existing costs; no performance improvement is claimed.

The IO stack still awaits its shared root package-lock update, whose managed lock belongs to another workstream. Local setup used `npm install --package-lock=false`; the repository lockfile remains unchanged and clean npm-ci/CI qualification is pending that integration.

Read-only integration review found another existing profile limit to qualify separately: object-reference `ToString` dispatch goes through generic object formatting instead of the registered StringWriter override. This batch covers direct StringWriter calls; virtual calls through object are not qualified. The serial probe on both source and compiled CIL confirmed direct output `x` versus object-reference output `System.IO.StringWriter`; logs are in `artifacts/string-reader-buffer-validation/object-tostring-gap.json`.


Closeout status: implementation complete; draft pending the shared root lockfile prerequisite. This branch is pushed at `3ffe7b9b7dd65475429d797b8825a81b2b33b1e3`. The seven-branch stack has been integrated with `main`, retaining its numeric framework registration alongside the IO/JSON contribution. Final integrated stack `bac87e4fcb3264886d6eeb6fff4c8089c29865c4` passed 320 focused source/CIL tests, static and structure checks, IO package smoke and build, all serially. These results qualify the combined stack; older per-batch results above retain their original revisions. Full browser/native/Wasm qualification remains deferred.

Required before merge:

1. Acquire the `package-json` lease after its current owner releases it. It is held by `codex-p19-core` / SF-A25-T01.1 (#2072), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, expiring 2026-10-04 20:04 UTC. Expiry alone does not authorize takeover.
2. In the first StringReader branch, regenerate `package-lock.json` to add the `@sharpforge/bcl-io` workspace link/package and the framework/runtime dependency entries, preserving other workstreams' entries. Root lockfile changes have deliberately not been applied while that lease is held; clean `npm ci` is expected to reject this stack until they are added.
3. Merge that first branch forward through its six children; rerun clean `npm ci`, the focused IO tests, static checks and build serially at the resulting integrated head.
4. Require passing `core`, then merge the seven PRs in order using merge commits, waiting for each automatic main check. Keep #2723 open for the unimplemented numeric/formatted, async/span and wrapper APIs.

Stack order: StringReader → StringWriter → buffered reader → object writer → buffer writer → buffer-line writer → character-line writer. This PR is item 2/7; its immediate predecessor is the PR base. The shared package lock is the current merge blocker; no lease override is assumed.

Publication only: automatic CI may be canceled to preserve the requested serial validation schedule. Canceled checks do not qualify the branch; rerun required core after the lockfile prerequisite is integrated.

IO PR stack: [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) → [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) → [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) → [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) → [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) → [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) → [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517)

Hosted closeout status: [37196533968](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196533968) cancelled, [37196531327](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196531327) cancelled. Rerun required core before merging; these canceled/failed checks do not establish readiness.

