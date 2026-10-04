# Main 349 reconciliation validation — 2026-10-04

This continuation preserves the original logs from serial validation after
integrating main `349c3d0d0375f2f15ffed4e102a7bfb8683c46e8` into the A05 work.
The [manifest](manifest.json) records the full tested revision, result counts,
byte length and SHA-256 for each completed run. Exact shell commands are retained
for the broad selections and later repair selections. The first five
cohorts' precise argument lists were lost during context compaction and are
explicitly marked unavailable; they were not reconstructed from test names.
Failed logs remain unchanged, including their complete diagnostics. All raw logs
retain their original whitespace; authored documentation and manifest checks do
not rewrite generated runner output.

| Tested revision | Log and cohort | Tests | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: | ---: |
| `38763edef` | [Main-merge integration](a05-main349-integration-r1.log) | 415 | 395 | 20 | 0 |
| `9055a2dd4` | [Profiler handles, reference and Wasm fairness](a05-profiler-handle-wasm-r1.log) | 130 | 130 | 0 | 0 |
| `3ad9a4bd7` | [Main-merge repairs](a05-main349-repairs-r1.log) | 123 | 123 | 0 | 0 |
| `c47260dfe` | [Default stack budget and source stack proof](a05-default-stack-proof-r1.log) | 112 | 112 | 0 | 0 |
| `629bb9736` | [Delegate protocol, native plan and vararg admission](a05-delegate-native-plan-r1.log) | 57 | 57 | 0 | 0 |
| `3b482d83b` | [Broad A05 integration selection](a05-main349-full-r1.log) | 3187 | 3162 | 25 | 0 |
| `cc75e3a98` | [Focused broad-run repairs](a05-full-repair-focused-r1.log) | 130 | 89 | 41 | 0 |
| `cc75e3a98` | [Selected security repairs](a05-security-repair-focused-r1.log) | 10 | 10 | 0 | 0 |
| `e67391b4b` | [Control-agent varargs follow-up](a05-control-varargs-e67391b4b.log) | 73 | 73 | 0 | 0 |
| `63f331913` | [Callback admission limits](a05-callback-admission-limits-r1.log) | 24 | 24 | 0 | 0 |
| `5379d076a` | [Broad A05 integration rerun](a05-main349-full-r2.log) | 3236 | 3236 | 0 | 0 |

These selections overlap. Their counts must not be added, and a later passing
focused selection does not turn an earlier failing broad selection into a pass.
The historical filename containing `full` identifies that original run; the
manifest's command defines its actual test selection.

The first run exposed typed-array fixture expectations, HashSet typed marker
growth, ordinary virtual-call callback-scope assumptions and a source stack-proof
integration issue. A selected repair cohort later passed. The broader run still
failed 25 cases, and the later focused run failed 41 cases in the varargs follow-up
and new source-return expectations. The separate ten-case security selection
passed. Each result remains attached to its own selection and revision.

The later control-agent run passed all 73 selected varargs and admission tests on
its own merged revision. Its [original provenance sidecar](a05-control-varargs-e67391b4b.json)
retains the exact command, Node `v24.19.0`, Git tree
`31d06531675067e580685546feba811de5b7c968` and the executing agent's clean tracked-tree
check. Both sidecar and log are hashed in the manifest. This follow-up does not
replace either earlier failed log or claim a rerun of the broad 3187-test selection.

The callback admission selection subsequently passed all 24 tests at `63f331913`.
The broad selection was then rerun on `5379d076a4b3152966a6680435ea694fbf907de3`
using the same shell selection as the original broad run: `tests/a05-*.test.js`,
`tests/preemption.test.js` and `tests/conformance/security/limits.test.js`. It passed
all **3236 tests, with no failures or skips**, in `357503.838018 ms`. This is a
passing result for that selected A05/preemption/security cohort on that revision,
not the entire repository or code added afterward. The preceding failed attempts
remain available for comparison; their counts are not added to the passing run.

Revisions and resource settings for the root logs are the run
coordinator's recorded values. Those logs do not embed Git clean-worktree captures
or exact Node/V8 version strings, so this archive does not manufacture those fields.
The SHA-256 hashes
establish byte identity with the supplied original logs, not independent proof of
the execution environment. These test logs are not T12 benchmark provenance.

These are Node test results. Tests of native qualification plans and browser
protocols do not imply an installed CLR or browser was executed. Actual Node Wasm
execution in the preemption tests is independently asserted there, but this test
log does not establish the full one-million-item fairness timing target. No T12
baseline, native SDK matrix, browser matrix or speedup claim follows from these
logs.
