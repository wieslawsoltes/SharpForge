# Project16 correction benchmark import review

Work-ID: **SF-A19-T12**. Reviewed source: `ccaf924054b60b83e4ccd127eeddda13f30bd849`.

## Required-check finding

[PR #4413](https://github.com/wieslawsoltes/SharpForge/pull/4413) failed its required core check in
[run 37182594704, job 111378010076](https://github.com/wieslawsoltes/SharpForge/actions/runs/37182594704/job/111378010076).
The reported static-gate failure was the missing reviewed inventory entry for this exact source:

| Field | Reviewed value |
|---|---|
| File | `scripts/benchmarks/a19-correction-paths.mjs` |
| Operation | `dynamic-import` |
| Source sites | **1**, at line 61 |
| Source bytes | **8,639** |
| SHA-256 | `87827deddeda04d6fdb6b055ff7448c3d8fe221759a5accf87ca6ab301ce5a3c` |

This change adds that one exact-hash/count/reason row to the existing
[dynamic-use inventory](../scripts/conformance/static/allowlist.json). The measured harness bytes are unchanged.

## Trusted host-code boundary

The benchmark is an explicitly invoked Node host tool. Its `capture --checkout ROOT --output JSON` argument names an
operator-selected **trusted executable checkout**, consistent with the existing BCL, CIL and integration-performance
benchmark entries. The one internal `load()` import site has five fixed callers in `loadApi()`:

| Target | Selection |
|---|---|
| `@sharpforge/editor` | Resolved public workspace package entry. |
| `@sharpforge/project-system` | Resolved public workspace package entry. |
| Document service | Fixed `apps/studio/workbench/documents.js` path. |
| Studio project adapter | Fixed `apps/studio/workbench/studio-projects.js` path. |
| Runtime activity adapter | Fixed `apps/studio/workers/runtime-activity.js` path. |

`sourceIdentity()` canonicalizes and checks the Git checkout root, rejects dirty tracked content, and records revision,
tree and untracked paths. It compares that identity again after capture. `packageEntries()` resolves workspace entries
canonically, rejects entries outside their corresponding checkout package directories, checks tracked entry paths and
checks workspace dependency resolution. `load()` independently requires each selected entry path to be tracked before
converting it with `pathToFileURL()` and importing it. Git runs through `execFileSync` with argument arrays, without a shell.

No model URI, C#/IL source text, project item path, result JSON or network response selects an import target. The direct
loader accepts local file URLs constructed from those fixed package/host paths, not remote module URLs. Workload source
is deterministic fixture data passed to the imported product APIs. The `compare` command parses JSON reports and never
calls `loadApi()`.

These checks establish source provenance and avoid loading a different workspace package by accident. They do **not**
sandbox a hostile checkout, authenticate a commit, or constrain trusted Node code and its dependency/loader environment.
Untracked paths are recorded, not universally forbidden; the selected module entries themselves must be tracked. The
operator must trust the checkout and host environment. This is the host-code boundary described in the
[threat model](../planning/qualification/threat-model.md), not an extension of managed-code authority.

## Unchanged gate and pending execution

The [static gate](../scripts/conformance/static/check-imports.js) still requires matching path, operation, count, nonempty
review reason and SHA-256, and still rejects absent, changed or stale entries. The lexical scanner, module linker,
required workflow, benchmark workloads/counts, correctness assertions and comparison thresholds are unchanged. This row
does not authorize unrelated dynamic imports or later modifications to the reviewed source.

Review consisted of source/policy inspection and reading the file bytes to confirm the reported hash/site. No scanner,
linker, test, build, gate or benchmark was executed for this correction. The integration owner will run the existing narrow
dynamic-use audit after the completed source scope is assembled; the original core failure remains recorded.

## Observed scoped audit

At source `4abe16d863d633b92c8782a12b13b6a1252077d4`, tree
`315d58ca90153c22a839060c2e849bf427cb0de9`, the unchanged `checkDynamicUses` function
inspected this one source and its one reviewed policy row: one import at line 61,
matching exact hash and count, zero errors, exit 0. The source stayed unchanged.
The operation ran through `node scripts/limited.js` on Node 24.19.0 from
2026-10-04T06:31:34.878096+00:00 to 2026-10-04T06:31:35.018160+00:00.
[Raw output, exact command and SHA-256 manifest](evidence/project16-pr10-import-review/manifest.json)
retain this bounded result. No module linking, whole-repository gate, product
tests, build or benchmark was repeated. The subsequent required PR core remains
pending at this evidence boundary; the original failed run is unchanged.
