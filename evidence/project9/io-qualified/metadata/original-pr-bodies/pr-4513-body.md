Task: SF-A09-T03.1

TextReader.Read(char[], index, count) and ReadBlock(char[], index, count) now execute against StringReader's existing managed source and cursor. They copy UTF-16 units into the destination slice, return the actual count, and return zero at EOF. Both methods validate the buffer and range before checking disposal, matching native behavior even for zero-count and invalid disposed reads.

The implementation reuses the BCL registry's base/extension groups. Canonical IO registration keeps reader IDs 655361–655367 and writer IDs 655368–655380 unchanged, then appends Read/ReadBlock at 655381–655382. No compiler, central VM, framework dispatcher or additional dependency changes.

Copying takes O(units read), keeps destination identity/capacity, and allocates no managed values. The reader, input and destination remain rooted across array write notifications; snapshots restore their ordinary heap state. The cursor commits after copying. A throwing host observer may expose completed buffer writes with the original cursor, and temporary roots are released on every exit.

Includes the unchanged 56-row native capture from .NET 10.0.5 / SDK 10.0.201 with source hash, executed by real source bytecode and independently assembled CIL. Cases cover complete/partial reads, offsets, EOF, zero counts, Int32 boundaries, validation/disposal precedence, NUL and isolated/split surrogates. Additional tests cover ABI order, managed allocation counters, storage identity, notifications, GC, snapshots and observer failure. Existing reader registration counts increase by two; the old missing-buffer negative case is replaced by still-unsupported ReadBlockAsync, with bound/legacy character-array calls now executing on both VMs after current-main integration.

This completes the array-buffer slice only. #2723 remains open for spans/memory, async APIs, Null/Synchronized wrappers, writer buffer/numeric/formatting/culture overloads and other pending IO work. User-defined reader implementations, external IDisposable dispatch, browser and Rust native/Wasm qualification remain outside this slice.

Stacked on the StringWriter scope, including the merged inherited-Dispose compiler fix and unchanged native writer source. Current-main integration removed obsolete Char compilation guards; real character writes and buffer calls now run on both source pipelines and VMs. Serial validation of the integrated stack passed 218 focused tests, `npm run check`, `npm run check:structure`, the invoked IO smoke and `npm run build`. Core and IO tarballs installed offline into an isolated project and the IO public smoke passed without workspace links. Logs: `artifacts/io-stack-integration-validation/`. Earlier full workspace package verification stopped at the unrelated editor CSS `.sf-editor` assertion; no all-package pass is claimed.

Publication still requires the root package-lock IO entries, currently held by another workstream’s managed lock. Local setup uses --package-lock=false and leaves that repository file untouched. The writer parent also retains a confirmed object-reference ToString dispatch limitation; direct StringWriter calls are verified.


Closeout status: implementation complete; draft pending the shared root lockfile prerequisite. This branch is pushed at `6f1e0c1dd89d8dc9129f10446ad548cb82a8fd37`. The seven-branch stack has been integrated with `main`, retaining its numeric framework registration alongside the IO/JSON contribution. Final integrated stack `bac87e4fcb3264886d6eeb6fff4c8089c29865c4` passed 320 focused source/CIL tests, static and structure checks, IO package smoke and build, all serially. These results qualify the combined stack; older per-batch results above retain their original revisions. Full browser/native/Wasm qualification remains deferred.

Required before merge:

1. Acquire the `package-json` lease after its current owner releases it. It is held by `codex-p19-core` / SF-A25-T01.1 (#2072), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, expiring 2026-10-04 20:04 UTC. Expiry alone does not authorize takeover.
2. In the first StringReader branch, regenerate `package-lock.json` to add the `@sharpforge/bcl-io` workspace link/package and the framework/runtime dependency entries, preserving other workstreams' entries. Root lockfile changes have deliberately not been applied while that lease is held; clean `npm ci` is expected to reject this stack until they are added.
3. Merge that first branch forward through its six children; rerun clean `npm ci`, the focused IO tests, static checks and build serially at the resulting integrated head.
4. Require passing `core`, then merge the seven PRs in order using merge commits, waiting for each automatic main check. Keep #2723 open for the unimplemented numeric/formatted, async/span and wrapper APIs.

Stack order: StringReader → StringWriter → buffered reader → object writer → buffer writer → buffer-line writer → character-line writer. This PR is item 3/7; its immediate predecessor is the PR base. The shared package lock is the current merge blocker; no lease override is assumed.

Publication only: automatic CI may be canceled to preserve the requested serial validation schedule. Canceled checks do not qualify the branch; rerun required core after the lockfile prerequisite is integrated.

IO PR stack: [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) → [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) → [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) → [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) → [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) → [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) → [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517)

Hosted closeout status: [37196542296](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196542296) cancelled. Rerun required core before merging; these canceled/failed checks do not establish readiness.

