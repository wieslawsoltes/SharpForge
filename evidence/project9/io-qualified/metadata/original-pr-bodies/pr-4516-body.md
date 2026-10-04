Task: SF-A09-T03.1

StringWriter and TextWriter now accept `WriteLine(char[])` and `WriteLine(char[], int, int)`, appending copied UTF-16 buffer text followed by the current newline. The overloads occupy new A09 slots 655385–655386; every existing contract ID stays unchanged.

The implementation reuses the released bounded bulk conversion, shared character-array validation and StringBuilder append. After the buffer append, it rechecks disposal and reads NewLine so callback changes take effect. Full-array null still writes the newline; slice validation precedes disposal. A newline failure retains the completed value. Existing WriteLine(string) keeps its single pre-write disposal check. No per-character managed strings, combined-size precheck or rollback guarantee is added.

The frozen SDK 10.0.201/runtime 10.0.5 reference contains 86 ordinary concrete/base-view cases and eight native-only subclass observations of mutation/disposal between value and newline writes. Source-bytecode and independent CIL tests replay ordinary rows; managed host-observer tests check matching sequencing, GC, partial progress and root cleanup. Separate bound/legacy compilation tests retain real TextWriter base references. The shared buffer harness is extracted without removing existing assertions.

Stacked on qualified WriterBuffer `31f92ab5`, including the merged registered-class conversion prerequisite; also includes the root's measured IO size-budget update `04aa65ad`. Related to #2723, which remains open for char/numeric/formatted WriteLine overloads, async/span APIs, wrappers and the remaining text IO scope. Custom subclasses, OS-specific default newline parity, ParamName and Rust execution remain outside this profile.

At `1ff8cd7b05a544d76682b3fcfae45d11406a3469`, 296 focused tests, static/structure checks, build, invoked IO smoke and isolated offline Core+IO package installation all passed serially. On WriterBuffer parent `04aa65ad` (same product as `31f92ab5`), 19 new tests failed for absent buffer-line contracts/overloads; the two existing string-line disposal controls passed. Native inputs and assertions were retained. The IO tarball is 9,059 bytes (28,474 unpacked), within the 10 KiB cap and 7.7% above the parent. Browser, full-suite and Rust/native/Wasm qualification were not run.

Benchmark: `node scripts/limited.js node --expose-gc scripts/benchmarks/a09-string-writer-line-buffer.mjs`, identical runner on parent and candidate. Node 24.21.0, macOS arm64 Apple M3 Pro; team jobs serial on a shared host. One warmup, five samples; median/p95 ms below. Each sample writes 64 payloads of 1,024 UTF-16 units plus one newline each (65,600 output units). Setup and final materialization are excluded.

| Path | Source before | Source after | CIL before | CIL after |
|---|---:|---:|---:|---:|
| string-line-control | 0.763/0.897 | 0.680/0.843 | 0.621/0.669 | 0.586/0.656 |
| separate-full-control | 1.941/2.227 | 1.853/2.003 | 2.045/2.466 | 1.968/2.295 |
| separate-slice-control | 1.896/2.364 | 1.777/2.306 | 2.374/2.609 | 1.938/2.272 |
| whole-buffer-line | absent | 1.768/2.240 | absent | 1.928/2.239 |
| slice-buffer-line | absent | 1.765/2.226 | absent | 1.943/2.241 |

Every path recorded 134 managed allocations, 136,496 allocated bytes and 128 slot writes, including builder storage growth. The new operations retain separate value/newline appends, with no per-character managed allocation. Existing control medians did not regress in this sample; no general speedup claim is made. Logs are retained in `artifacts/string-writer-line-buffer-validation/` in the implementation worktree. Publication awaits the previously requested root package-lock integration; the other team's lock is preserved.


Closeout status: implementation complete; draft pending the shared root lockfile prerequisite. This branch is pushed at `cbeffbae0b2968f82c5fefa2ca6b9bae8c67f82c`. The seven-branch stack has been integrated with `main`, retaining its numeric framework registration alongside the IO/JSON contribution. Final integrated stack `bac87e4fcb3264886d6eeb6fff4c8089c29865c4` passed 320 focused source/CIL tests, static and structure checks, IO package smoke and build, all serially. These results qualify the combined stack; older per-batch results above retain their original revisions. Full browser/native/Wasm qualification remains deferred.

Required before merge:

1. Acquire the `package-json` lease after its current owner releases it. It is held by `codex-p19-core` / SF-A25-T01.1 (#2072), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, expiring 2026-10-04 20:04 UTC. Expiry alone does not authorize takeover.
2. In the first StringReader branch, regenerate `package-lock.json` to add the `@sharpforge/bcl-io` workspace link/package and the framework/runtime dependency entries, preserving other workstreams' entries. Root lockfile changes have deliberately not been applied while that lease is held; clean `npm ci` is expected to reject this stack until they are added.
3. Merge that first branch forward through its six children; rerun clean `npm ci`, the focused IO tests, static checks and build serially at the resulting integrated head.
4. Require passing `core`, then merge the seven PRs in order using merge commits, waiting for each automatic main check. Keep #2723 open for the unimplemented numeric/formatted, async/span and wrapper APIs.

Stack order: StringReader → StringWriter → buffered reader → object writer → buffer writer → buffer-line writer → character-line writer. This PR is item 6/7; its immediate predecessor is the PR base. The shared package lock is the current merge blocker; no lease override is assumed.

Publication only: automatic CI may be canceled to preserve the requested serial validation schedule. Canceled checks do not qualify the branch; rerun required core after the lockfile prerequisite is integrated.

IO PR stack: [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) → [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) → [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) → [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) → [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) → [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) → [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517)

Hosted closeout status: [37196577091](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196577091) cancelled. Rerun required core before merging; these canceled/failed checks do not establish readiness.

