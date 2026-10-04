Task: SF-A09-T03.1; partial progress toward #2723.

StringWriter now returns its current builder text through an `object` reference. For example, `object value = writer; value.ToString()` produces the written text instead of `System.IO.StringWriter`, including after disposal and subsequent builder mutations.

The only product change marks the existing parameterless StringWriter.ToString contract as an Object.ToString override. ID 655380 is unchanged; GetStringBuilder remains 655379. Dispatch, null handling and CIL call-kind behavior reuse the framework override prerequisite. No runtime dispatcher or formatting implementation is added. The framework test's exact opt-in list now includes StringWriter alongside StringBuilder and Uri.

Pinned .NET 10.0.5 evidence contains ten actual `call`/`callvirt` cases: empty, written, disposed, mutated after disposal and null. Eighteen focused tests cover compiled source, direct CIL, profile round trips, independent CIL instructions, observer-triggered GC, snapshots, disposal faults and allocation failure. Serial validation at `86653227` passed 257 focused and affected tests, `npm run check`, `npm run check:structure`, and the invoked IO package smoke. The initial 257 tests also passed, then the check identified the missing A09 manifest entry; that entry is added in the final commit. The complete framework prerequisite has merged as #3681. Logs: `artifacts/string-writer-object-validation/`.

Depends on the StringReader/StringWriter/buffer stack and framework Object.ToString prerequisite `78aa537e`. Issue #2723 remains open for buffer/async and other text IO surfaces. Primitive, Convert and Console profiles remain unchanged. Rust native/Wasm execution is not qualified by this change.

Publication awaits the IO root package-lock addition; the existing package-json lock belongs to another team and the narrow override question is pending. Local setup leaves the repository lockfile unchanged.


Closeout status: implementation complete; draft pending the shared root lockfile prerequisite. This branch is pushed at `376c1955474d04a5386e22352a8f27a18a46f2c5`. The seven-branch stack has been integrated with `main`, retaining its numeric framework registration alongside the IO/JSON contribution. Final integrated stack `bac87e4fcb3264886d6eeb6fff4c8089c29865c4` passed 320 focused source/CIL tests, static and structure checks, IO package smoke and build, all serially. These results qualify the combined stack; older per-batch results above retain their original revisions. Full browser/native/Wasm qualification remains deferred.

Required before merge:

1. Acquire the `package-json` lease after its current owner releases it. It is held by `codex-p19-core` / SF-A25-T01.1 (#2072), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, expiring 2026-10-04 20:04 UTC. Expiry alone does not authorize takeover.
2. In the first StringReader branch, regenerate `package-lock.json` to add the `@sharpforge/bcl-io` workspace link/package and the framework/runtime dependency entries, preserving other workstreams' entries. Root lockfile changes have deliberately not been applied while that lease is held; clean `npm ci` is expected to reject this stack until they are added.
3. Merge that first branch forward through its six children; rerun clean `npm ci`, the focused IO tests, static checks and build serially at the resulting integrated head.
4. Require passing `core`, then merge the seven PRs in order using merge commits, waiting for each automatic main check. Keep #2723 open for the unimplemented numeric/formatted, async/span and wrapper APIs.

Stack order: StringReader → StringWriter → buffered reader → object writer → buffer writer → buffer-line writer → character-line writer. This PR is item 4/7; its immediate predecessor is the PR base. The shared package lock is the current merge blocker; no lease override is assumed.

Publication only: automatic CI may be canceled to preserve the requested serial validation schedule. Canceled checks do not qualify the branch; rerun required core after the lockfile prerequisite is integrated.

IO PR stack: [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) → [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) → [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) → [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) → [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) → [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) → [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517)

Hosted closeout status: [37196552922](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196552922) cancelled, [37196550207](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196550207) cancelled. Rerun required core before merging; these canceled/failed checks do not establish readiness.

