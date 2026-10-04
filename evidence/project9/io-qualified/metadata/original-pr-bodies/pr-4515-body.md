Task: SF-A09-T03.1

StringWriter and TextWriter now support `Write(char[])` and `Write(char[], index, count)` through the existing managed writer. The contracts append at A09 IDs 655383 and 655384, after the reader buffer slots; existing IDs remain unchanged.

Null whole-array writes do nothing even after disposal. Slice writes validate the buffer and range before checking disposal, including empty slices. Shared char-array validation preserves the existing StringReader rules. Each nonempty write converts UTF-16 in bounded 4096-unit host blocks and calls the existing StringBuilder append once, preserving NUL and isolated surrogates without per-character managed strings or retained caller buffers.

The native .NET 10.0.5 snapshot contains 70 concrete/base-call cases with source hashes, input/output units and fault information. Focused regressions execute those cases through source bytecode and independently assembled CIL, plus bound/legacy source calls on both VMs. GC, snapshots, copied input, allocation limits, observer faults, contract IDs, registration order and package smoke counts are covered. At integrated product `31f92ab5`, 275 focused tests passed, plus static/structure checks, build, invoked IO smoke, and isolated offline installation of Core+IO tarballs. The final metadata-only `04aa65ad` records measured package size. The first run exposed four real class-upcast compiler failures; PR #3775 fixes that prerequisite, and the real compiled base-reference fixtures now pass unchanged. The earlier red baseline fails all 17 new tests, including missing contracts and four compiler/overload paths; it is not presented as an isolated bulk-writer algorithm regression.

The static benchmark `scripts/benchmarks/a09-string-writer-buffer.mjs` uses actual VM platform dispatch, one warmup and five samples, with setup and final output checks excluded. The same runner was copied to baseline `86653227`. Existing string/character writes are controls; new buffer paths are reported separately and skipped when absent on the baseline. It reports managed allocations, allocated bytes and slot writes; measurements follow below.

Conversion costs O(count) time and O(count) temporary host text. The shared one-million-unit host limit is checked before conversion. Existing StringBuilder observer behavior is retained: exceptions from host observers can interrupt field updates, so this is not a transactional rollback API. Native parameter names are evidence only; ArgumentException.ParamName is not added. Rust native/Wasm execution is not qualified.

Depends on the StringWriter Object.ToString child (including its A09 manifest correction at `86653227`). Issue #2723 remains open; WriteLine buffer overloads, spans/memory, async and the remaining writer surfaces are separate batches.

Validation was serial on Node 24.21.0, macOS arm64 Apple M3 Pro; only this team was controlled on the shared host. Command: `node scripts/limited.js node --expose-gc scripts/benchmarks/a09-string-writer-buffer.mjs`. Each row produces 65,536 UTF-16 units: 64 calls with a 1,024-unit payload, or equivalent individual character calls. Times are median/p95 ms (one warmup, five samples); new buffer paths are absent on the parent.

| Path | Source before | Source after | CIL before | CIL after | Allocations / bytes / slot writes |
|---|---:|---:|---:|---:|---:|
| string-control | 0.539/0.641 | 0.622/2.049 | 0.534/0.716 | 0.453/0.599 | 69 / 133,776 / 64 |
| character-control | 79.720/88.304 | 83.070/86.870 | 87.356/90.869 | 89.073/94.991 | 65,551 / 2,752,976 / 65,536 |
| whole-buffer | absent | 1.775/1.956 | absent | 1.824/2.173 | 69 / 133,776 / 64 |
| slice-buffer | absent | 1.711/2.077 | absent | 1.808/2.217 | 69 / 133,776 / 64 |

String-control source median increased 0.083 ms (+15.3%) in this short shared-host sample; its p95 was noisy. Existing character-control medians increased 4.2% source/2.0% CIL and allocations stayed identical. These results are disclosed for review, with no broad performance-neutrality or speedup claim. Bulk calls avoid per-character managed objects: 69 total allocations including builder growth versus 65,551 for equivalent individual character writes.

The IO tarball is 8,412 bytes (26,137 unpacked), up from 6,876 bytes for the earlier reader-buffer stack as writer-object and buffer functionality were added. This exceeds the unmeasured 8 KiB reader-only cap. The PR records the actual measurement and proposes 10 KiB, using the existing 15% headroom rounded to 1 KiB rule. The isolated package smoke passed; broader workspace package qualification was not run in this increment. Logs are retained under `artifacts/string-writer-buffer-validation/`. Publication still awaits the previously requested narrow root package-lock override; no shared-lock takeover occurred.


Closeout status: implementation complete; draft pending the shared root lockfile prerequisite. This branch is pushed at `955da4bb7197d027c5471034ed01e6e4dcd60a31`. The seven-branch stack has been integrated with `main`, retaining its numeric framework registration alongside the IO/JSON contribution. Final integrated stack `bac87e4fcb3264886d6eeb6fff4c8089c29865c4` passed 320 focused source/CIL tests, static and structure checks, IO package smoke and build, all serially. These results qualify the combined stack; older per-batch results above retain their original revisions. Full browser/native/Wasm qualification remains deferred.

Required before merge:

1. Acquire the `package-json` lease after its current owner releases it. It is held by `codex-p19-core` / SF-A25-T01.1 (#2072), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, expiring 2026-10-04 20:04 UTC. Expiry alone does not authorize takeover.
2. In the first StringReader branch, regenerate `package-lock.json` to add the `@sharpforge/bcl-io` workspace link/package and the framework/runtime dependency entries, preserving other workstreams' entries. Root lockfile changes have deliberately not been applied while that lease is held; clean `npm ci` is expected to reject this stack until they are added.
3. Merge that first branch forward through its six children; rerun clean `npm ci`, the focused IO tests, static checks and build serially at the resulting integrated head.
4. Require passing `core`, then merge the seven PRs in order using merge commits, waiting for each automatic main check. Keep #2723 open for the unimplemented numeric/formatted, async/span and wrapper APIs.

Stack order: StringReader → StringWriter → buffered reader → object writer → buffer writer → buffer-line writer → character-line writer. This PR is item 5/7; its immediate predecessor is the PR base. The shared package lock is the current merge blocker; no lease override is assumed.

Publication only: automatic CI may be canceled to preserve the requested serial validation schedule. Canceled checks do not qualify the branch; rerun required core after the lockfile prerequisite is integrated.

IO PR stack: [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) → [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) → [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) → [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) → [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) → [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) → [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517)

Hosted closeout status: [37196566025](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196566025) cancelled, [37196562371](https://github.com/wieslawsoltes/SharpForge/actions/runs/37196562371) cancelled. Rerun required core before merging; these canceled/failed checks do not establish readiness.

