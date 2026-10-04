# Project 16 local09 correction qualification

The completed local record contains **failed full-area executions followed by a passing affected-file retry**.
It does not establish a new full-area pass on the final correction source. The
[machine-readable ledger](project16-followup-local-qualification.json) retains exact source/tree identities,
commands, failure details, skip reasons, and the raw-file byte counts and SHA-256 hashes.

## Recorded executions

| Execution | Local source | Observed outcome | Retained evidence |
|---|---|---|---|
| Initial A19/A20 discovery | `6085a6ede46cc5f46ea9603d46c3e281b28ec65a` | Both processes exited 1 because `test_workflow_diagnostics.py` was unassigned. **Neither area executed tests.** | [Summary](evidence/project16-followup-local/p16-followup-local/node-summary.json), [A19](evidence/project16-followup-local/p16-followup-local/A19.log), [A20](evidence/project16-followup-local/p16-followup-local/A20.log) |
| Full A19 | `80dfe3f5a7d18731915bf9b6b770f816911b4f0f` | **748 tests: 746 passed, 2 failed, 0 skipped.** | [A19 log](evidence/project16-followup-local/p16-followup-local-r1/A19.log) |
| Full A20 | `80dfe3f5a7d18731915bf9b6b770f816911b4f0f` | **712 tests: 702 passed, 1 failed, 9 skipped.** | [A20 log](evidence/project16-followup-local/p16-followup-local-r1/A20.log) |
| Two affected files after correction | `56add0e83ad85e65392f19af57535a97cad5d4ed` | **22 tests: 22 passed, 0 failed, 0 skipped.** This reruns cases already included above. | [Summary](evidence/project16-followup-local/p16-followup-local-r2/summary.json), [log](evidence/project16-followup-local/p16-followup-local-r2/affected-tests.log) |

The initial discovery attempt ran at 04:45 UTC on 2026-10-04. After ownership registration, the full A19 and A20
areas ran serially from 04:47:18 to 04:48:38 UTC. The affected retry completed at 04:51:38 UTC.
These are local execution records; this archive does not infer corresponding published GitHub commits.
No counts are added across these attempts, areas, Python contracts, or earlier ledgers.

## Failures and correction

The two A19 failures were in `tests/a19-preview-source-publication.test.js`. They requested the editor service name
`documentSymbols` directly from the compiler transport, which correctly rejected it with `UNKNOWN_METHOD`.
Production maps that service to the compiler's `symbols` method. Correction
`a179e686d81026ff19773147d060d9c879fae9cb` uses the real method and adds an exact `analyze`/`symbols` request-sequence
assertion while retaining the source/version checks.

The A20 failure was in `tests/a20-model-preview-publication.test.js`. Its no-normalization save fixture omitted
CodeEditor's explicit `endOfLineExplicit: false` default, enabling normalization and correctly receiving
`SFEDITOR_SAVE_STALE` during preview. The fixture now supplies that real default. The enabled-normalization rejection
assertion remains. Merge `56add0e8` contains these fixture corrections; the original failed logs remain byte-identical.

The retry command was:

```sh
node scripts/limited.js node --test tests/a19-preview-source-publication.test.js tests/a20-model-preview-publication.test.js
```

The full-area commands were `node scripts/planning/run-tests.js --area A19` and
`node scripts/planning/run-tests.js --area A20`; their original arguments and timestamps are in the
[full-area summary](evidence/project16-followup-local/p16-followup-local-r1/node-summary.json).

All nine A20 skips remain skips: six documented Vim/host capability limits, unavailable desktop Vim oracle
qualification, browser-key/assistive qualification, and the unavailable pinned Unicode 16.0 native Intl comparison.
Their exact names and reasons are in the JSON ledger and original log. None is counted as a pass.

## Python contracts and bounded source inspection

At `80dfe3f5`, the [Python contract log](evidence/project16-followup-local/p16-followup-python/contracts.log)
records **12 tests passed** under:

```sh
node scripts/limited.js python -m unittest discover -s tests/conformance/browser -p test_workflow_*.py
```

Its printed `wrapper_standalone` JSON with `passed: false`, `fixture-browser`, and `fixture failure` is an intentional
unit-fixture payload. It is **not an actual browser run**. The
[summary](evidence/project16-followup-local/p16-followup-python/summary.json) also records four Python files parsed
with `ast.parse`; their names are retained exactly. No separate AST invocation or timestamp was durably captured.

The [source inspection](evidence/project16-followup-local/p16-followup-static/structure.json) covers exactly
**48 changed source files at `80dfe3f5` compared with `8d1be9c`**, with zero new violations. Root's inline Python
read Git blobs and checked 500 lines, 40,960 bytes, new lines over 160 characters, and frozen files only shrinking.
The frozen `apps/studio/studio.js` row is 746 lines, 104,451 bytes, and 242 bytes smaller than the comparison base.
This is a bounded changed-source inspection, not a whole-repository or final-head core pass. Its exact inline invocation
and timestamp were not retained; both remain `null` in the ledger rather than being reconstructed.

## Evidence boundary

The archive contains **11 original files, 160,651 bytes**, copied and compared byte-for-byte.
Existing ledgers were left unchanged. Separate model-performance evidence remains with the text agent's archive.
This archive operation executed no tests, builds, benchmarks, browsers, or static gates.

At this evidence cutoff, actual corrected Studio browser/standalone workflows and the application build after the source
corrections remain pending. The original hosted failures are unchanged. No native, assistive, cross-platform or browser
latency acceptance, and no automatic issue closure, follows from these local results.
