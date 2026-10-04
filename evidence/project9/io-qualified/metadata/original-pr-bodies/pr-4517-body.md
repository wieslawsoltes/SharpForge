Task: SF-A09-T03.1

StringWriter and TextWriter now expose `WriteLine(char)` at appended A09 contract 655387. It writes one UTF-16 code unit through the existing character path, then rechecks disposal and appends the current newline. A completed character remains visible if disposal, allocation failure or the host text limit prevents the newline.

The change reuses the existing character conversion, StringBuilder append and newline helper. Null/disposed checks retain their existing precedence. NUL and lone surrogates remain exact UTF-16 units. Write(char), WriteLine(string) and both buffer overloads keep their released behavior and IDs; only the new character-line path gains the second disposal check.

The frozen SDK 10.0.201/runtime 10.0.5 capture contains 40 concrete/base-view cases and four native-only observations of NewLine mutation/disposal between character and newline writes. Twenty-one focused cases cover source platform calls, independent CIL, bound/legacy compiled base references, invalid host values, GC, snapshots, allocation limits, observer failures and partial progress. Native subclasses serve only as sequencing observations; this does not enable custom TextWriter subclasses.

Stacked on validated buffer-line head `1ff8cd7b`. Related to #2723, which remains open for numeric/formatted writer overloads, async/span APIs, wrappers and other remaining text IO work. At `825d7906`, 317 focused tests, static/structure checks, build, invoked IO smoke and isolated offline Core+IO package installation passed serially. The IO tarball is 9,439 bytes (29,892 unpacked), within the 10 KiB cap and 4.2% above its parent. The native snapshot is committed unchanged. On parent `1ff8cd7b`, 19 new tests failed for the absent character-line overload; two existing character-write controls passed. Browser, full-suite and Rust/native/Wasm qualification were not run. Reproduction with its oracle is `d4e105e7`.

The existing `scripts/benchmarks/a09-string-writer-line-buffer.mjs` runner now includes separate Write(char)+WriteLine() and new WriteLine(char) cases while retaining previous controls. Copy it unchanged to baseline `1ff8cd7b`; it uses actual source/CIL platform dispatch, excludes setup/materialization, and reports one warmup, five samples and allocation/write counts. No tests, builds, benchmarks, package operations or native jobs were run by the implementing helper.

Measured with `node scripts/limited.js node --expose-gc scripts/benchmarks/a09-string-writer-line-buffer.mjs` on Node 24.21.0, macOS arm64 Apple M3 Pro, serial team jobs on a shared host. Identical runner on parent/candidate; median/p95 milliseconds below. Each sample makes 64 logical line writes; string/buffer rows write 1,024 units plus newline, while character rows write one unit plus newline.

| Path | Source before | Source after | CIL before | CIL after |
|---|---:|---:|---:|---:|
| string-line-control | 0.719/0.894 | 0.739/0.892 | 0.577/0.686 | 0.607/0.625 |
| separate-full-control | 2.403/3.416 | 1.885/2.063 | 2.080/3.040 | 1.973/2.315 |
| separate-slice-control | 1.864/2.325 | 1.810/2.294 | 2.051/2.505 | 1.895/2.275 |
| whole-buffer-line | 1.960/2.370 | 1.805/2.286 | 2.060/2.446 | 1.957/2.214 |
| slice-buffer-line | 1.967/2.378 | 1.827/2.207 | 2.276/2.534 | 1.884/2.288 |
| separate-character-control | 0.428/0.456 | 0.403/0.486 | 0.490/0.845 | 0.421/0.446 |
| character-line | absent | 0.346/0.461 | absent | 0.356/0.382 |

All rows retain 134 managed allocations and 128 slot writes, including builder storage growth. Character cases allocate 5,552 bytes; string/buffer cases allocate 136,496 bytes because they produce longer output. The string-line control rose 2.7% source and 5.3% CIL (about 0.03 ms per sample); this small measured dispatch cost is accepted for the new character branch, with no broad speedup or no-regression claim. Other control medians did not regress. Logs: `artifacts/string-writer-char-line-validation/` in the implementation worktree. Publication awaits the previously requested narrow root package-lock override; the shared lock remains untouched.


Closeout status: implementation complete; draft pending the shared root lockfile prerequisite. This branch is pushed at `bac87e4fcb3264886d6eeb6fff4c8089c29865c4`. The seven-branch stack has been integrated with `main`, retaining its numeric framework registration alongside the IO/JSON contribution. Final integrated stack `bac87e4fcb3264886d6eeb6fff4c8089c29865c4` passed 320 focused source/CIL tests, static and structure checks, IO package smoke and build, all serially. These results qualify the combined stack; older per-batch results above retain their original revisions. Full browser/native/Wasm qualification remains deferred.

Required before merge:

1. Acquire the `package-json` lease after its current owner releases it. It is held by `codex-p19-core` / SF-A25-T01.1 (#2072), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, expiring 2026-10-04 20:04 UTC. Expiry alone does not authorize takeover.
2. In the first StringReader branch, regenerate `package-lock.json` to add the `@sharpforge/bcl-io` workspace link/package and the framework/runtime dependency entries, preserving other workstreams' entries. Root lockfile changes have deliberately not been applied while that lease is held; clean `npm ci` is expected to reject this stack until they are added.
3. Merge that first branch forward through its six children; rerun clean `npm ci`, the focused IO tests, static checks and build serially at the resulting integrated head.
4. Require passing `core`, then merge the seven PRs in order using merge commits, waiting for each automatic main check. Keep #2723 open for the unimplemented numeric/formatted, async/span and wrapper APIs.

Stack order: StringReader → StringWriter → buffered reader → object writer → buffer writer → buffer-line writer → character-line writer. This PR is item 7/7; its immediate predecessor is the PR base. The shared package lock is the current merge blocker; no lease override is assumed.

Publication only: automatic CI may be canceled to preserve the requested serial validation schedule. Canceled checks do not qualify the branch; rerun required core after the lockfile prerequisite is integrated.

IO PR stack: [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) → [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) → [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) → [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) → [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) → [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) → [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517)

Hosted closeout status: [37196588089](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196588089) cancelled, [37196585850](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196585850) cancelled. Rerun required core before merging; these canceled/failed checks do not establish readiness.

