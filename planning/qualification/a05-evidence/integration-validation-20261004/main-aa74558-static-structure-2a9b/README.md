# Static checks and strict-structure differential at 2a9b

The ordinary static check failed at 3505, then **passed at 2a9b** after an exact
reviewed hash update for the already-allowed managed evaluator method `eval(n)`.
The separate optional **strict structure check failed at 2a9b with 265 reported
problems**. The successful ordinary check is not a global structure pass.

| Recorded command | Clean tested commit / tree | Exit | Wall time |
|---|---|---:|---:|
| `npm run check` before reviewed hash update | `3505b8a50d0f6e860c5a8b8eeebb239830eca6b0` / `290d3cb62d20dbba7347d23550e6b0acb4d6f4ae` | 1 | 7.16823500800092 s |
| `npm run check` after reviewed hash update | `2a9b265292bc24a94f7d393f206d12caa135c021` / `9fd550a176b5878b4fa5994a643457c9f31ea27b` | 0 | 6.999676737003028 s |
| `node scripts/quality/check-structure.js --strict` | Same clean 2a9b commit/tree | 1 | 5.25884050699824 s |

All original journals report the same clean identity at start and end. Each
command used the limiter with one run slot, serial tests and a 512 MiB V8 cap,
on Node v24.19.0. Exact ordered argv, timestamps and environment remain in the
original execution JSON files. The strict log also retains its initial
run-slot waiting notice.

## Original results

Both ordinary checks reported 4,830 syntax-checked modules and zero syntax
errors, 1,360 registered Node files, 38 browser scripts, and zero unassigned or
duplicate owners. At 3505, dynamic-code checking failed with two diagnostics
for the changed/stale exact hash of `packages/debugger/src/evaluation.js`.
At 2a9b it passed, inspecting 4,774 files and 4,821 modules with zero errors.
The archive records the evaluator source and allow-list identities for both
revisions; it does not treat the method named `eval` as host JavaScript eval.

The strict checker and its frozen baseline are byte-identical between exact
main `aa74558ccae4851817b23d0a19c5fdfb1ef5a350` and tested 2a9b:

- Checker Git blob: `fcf46cd1efeb4ca4d590ed11e92099d30f8dbf44`.
- Baseline Git blob: `c0386bebc22e559f89a2ed55d397e8be9a7c86d7`.

## Classification of the actual 265 diagnostics

| Classification against exact main | Reported paths | Meaning |
|---|---:|---|
| Byte-identical main source | 238 | Existing main violations under the same checker and baseline. |
| Changed source; offending metrics unchanged or smaller | 26 | Existing violations remain, with no new or grown offending metric. |
| New integration file | 1 | An integration-introduced line-length violation, listed below. |
| Grown offending metric in an existing file | 0 | None among the 265 reported paths. |

The sole new actionable strict violation is
`packages/cil/src/async-runtime-profile.js:91`: the `asyncValue` conditional is
**174 UTF-16 code units**, exceeding **160**. The file is otherwise within
limits at 138 lines and 6,260 bytes. Wrapping that conditional is sufficient
for this finding; no baseline change is needed. Correcting it alone would
leave the 264 observed existing-main violations, so it must not be reported as
a clean global strict check.

The checker calls a file “new” whenever it is absent from the frozen baseline;
that label alone does not establish that this integration introduced it.
The [complete differential assessment](strict-structure-classification-2a9b.json)
lists all 265 paths, original diagnostics, main/candidate Git blobs and SHA-256
hashes, measured metrics, applicable limits and classification. Its calculation
matches the checker: LF split including the final empty line, UTF-8 bytes and
JavaScript UTF-16 line lengths, with the exact shared baseline. It reads Git
objects only and covers the actual reported paths. No Node checker or full
main baseline run was performed for this assessment, and no total main gate
count beyond these observed paths is inferred.

## Preservation and scope

[manifest.json](manifest.json) records exact byte counts, SHA-256 digests and
source paths for all six original log/journal files, plus the separately marked
derived assessment and relevant source identities. Raw files are byte-identical
copies from `/workspace/scratch/42f7738360b9/a05-main-aa74558-validation-20261004/`.
All failures are preserved. This archive changes no product, acceptance ledger,
checker or baseline and makes no full A05, performance, release-size or global
structure-pass claim. No test, build or benchmark ran while preparing it.
