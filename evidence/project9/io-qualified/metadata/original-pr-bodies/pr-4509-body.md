Task: SF-A09-T03.1

Add synchronous StringReader reads through a new `@sharpforge/bcl-io` module. `Read`/`Peek` return UTF-16 code units, `ReadLine` handles CR/LF/CRLF and EOF, and `ReadToEnd` returns the remaining text. Close/Dispose are idempotent; subsequent reads throw ObjectDisposedException.

TextReader is abstract metadata with StringReader as its derived type. Managed heap fields retain the source and cursor, participate in snapshots and GC, and release the source on disposal. Returned strings stay rooted across write observers; failed output allocation leaves the cursor unchanged.

The package uses the existing BCL registry, core host helpers and runtime adapter. IO contracts append at A09 IDs 655361–655367 after released JSON GetInt64 655360. No released IDs or central VM dispatchers change. The package includes its license, public API documentation, build contribution and package smoke. The npm tarball measured 3,658 bytes at `e93a9743`, below its 8 KiB cap.

Native capture succeeded with SDK 10.0.201 and .NET 10.0.5: 45 committed lines contain 35 unchanged-program observations, a separator, and nine fault/base-type observations. Serial local validation at integrated current-main head `b3e5af88` passed 171 focused and affected cases, `npm run check`, `npm run check:structure`, and the invoked IO package smoke. The 19 reader tests cover both VMs, independent ordinary CIL base calls/casts, managed GC/snapshot/write observers/OOM, metadata, using cleanup, and explicit deferred-API guards.

Partial progress on #2723; keep it open. Buffer/ReadBlock and async methods, TextReader.Null/Synchronized, TextWriter/StringWriter and formatting/culture providers remain separate batches. Existing source `using` calls Dispose directly; external `IDisposable.Dispose` calls remain outside the verified CIL profile. Rust native/Wasm is not qualified here.

Integration outside A09: framework/runtime per-package dependencies, A09 framework contribution composition, runtime module registration, and the release-size budget. Root package files are unchanged because their managed lock belongs to another workstream; the package-lock workspace/dependency entries must be integrated before a clean npm-ci/CI qualification and publication. Local implementation validation used `npm install --package-lock=false --ignore-scripts --no-audit --no-fund`; the repository lockfile was verified unchanged. `npm ci` correctly rejects the currently missing IO entry.


Closeout status: implementation complete; draft pending the shared root lockfile prerequisite. This branch is pushed at `408cae030fcf2738c38e13ad33a3efe5ecade0e2`. The seven-branch stack has been integrated with `main`, retaining its numeric framework registration alongside the IO/JSON contribution. Final integrated stack `bac87e4fcb3264886d6eeb6fff4c8089c29865c4` passed 320 focused source/CIL tests, static and structure checks, IO package smoke and build, all serially. These results qualify the combined stack; older per-batch results above retain their original revisions. Full browser/native/Wasm qualification remains deferred.

Required before merge:

1. Acquire the `package-json` lease after its current owner releases it. It is held by `codex-p19-core` / SF-A25-T01.1 (#2072), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, expiring 2026-10-04 20:04 UTC. Expiry alone does not authorize takeover.
2. In the first StringReader branch, regenerate `package-lock.json` to add the `@sharpforge/bcl-io` workspace link/package and the framework/runtime dependency entries, preserving other workstreams' entries. Root lockfile changes have deliberately not been applied while that lease is held; clean `npm ci` is expected to reject this stack until they are added.
3. Merge that first branch forward through its six children; rerun clean `npm ci`, the focused IO tests, static checks and build serially at the resulting integrated head.
4. Require passing `core`, then merge the seven PRs in order using merge commits, waiting for each automatic main check. Keep #2723 open for the unimplemented numeric/formatted, async/span and wrapper APIs.

Stack order: StringReader → StringWriter → buffered reader → object writer → buffer writer → buffer-line writer → character-line writer. This PR is item 1/7; its immediate predecessor is the PR base. The shared package lock is the current merge blocker; no lease override is assumed.

Publication only: automatic CI may be canceled to preserve the requested serial validation schedule. Canceled checks do not qualify the branch; rerun required core after the lockfile prerequisite is integrated.

IO PR stack: [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) → [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) → [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) → [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) → [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) → [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) → [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517)

Hosted closeout status: [37196521585](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196521585) cancelled, [37196517532](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196517532) cancelled. Rerun required core before merging; these canceled/failed checks do not establish readiness.

