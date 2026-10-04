# Project 16 acceptance correction evidence

The completed local correction scope has affected passing evidence for every
observed initial failure. **There is no new all-in-one full-scope pass on the
latest source, and the corrected product remains browser-unqualified.** The
[JSON ledger](project16-acceptance-corrections.json) retains exact source trees,
commands through raw reports, outcomes, file sizes and SHA-256 hashes. No issue
is closed by this record.

| Observation | Exact local source | Original result and interpretation |
|---|---|---|
| Complete initial A19 | `c2c69a1ae200c239060e087cfa3f5167ac6eb21b` | 477 tests: 441 passed, 36 failed, zero skipped. All failures were file imports blocked by the missing upstream `@sharpforge/bcl-collections` workspace link. |
| Complete initial A20 | `c2c69a1ae200c239060e087cfa3f5167ac6eb21b` | 573 tests: 551 passed, 13 failed, nine skipped. All failures had the same workspace-link cause. Skips remain skipped. |
| Affected Node retry | `d5df3806275715b8faea78bb93b697b2cf91897b` | 49 blocked files plus two new instrumentation files: 51 files, 402 tests, 390 passed, 12 failed. All 12 failures were in the first-run fixture, which bypassed construction without providing metrics. |
| First-run and direct performance consumer retry | `0858f721e8e737e6bcca1365748409cb6b0b5f35` | Two files, 23 tests: 23 passed, zero failed or skipped. The first-run fixture now provides real `WorkbenchPerformance`; shell commands cover the direct performance consumer after the mark lifecycle change. |

The integration owner restored workspace links with
`npm ci --ignore-scripts --offline --no-audit --no-fund`: 28 workspace packages
were added, with no source or lockfile changes. That setup fact is owner-reported;
no separate installation log was supplied. The original failing reports remain
failed. Overlapping case counts and file-import failures are not added into an
aggregate pass count.

The source trees, in the table's order, are
`44fe8d2f5a58097c81d170706f4b20c389979077` for both initial runs,
`1e2db8ef4c6196f0257c61e94a1a030758a592b7` for the affected retry, and
`543ac1fd0f99e60bd7be5319ecad1590ba1eeccd` for the final two-file retry.
These are recorded local execution identities; this ledger does not infer
public commit equivalence.

The exact raw Node reports and logs are archived together:

- Initial [A19 report](evidence/project16-acceptance/p16-acceptance-A19.json)
  and [log](evidence/project16-acceptance/p16-acceptance-A19.log).
- Initial [A20 report](evidence/project16-acceptance/p16-acceptance-A20.json)
  and [log](evidence/project16-acceptance/p16-acceptance-A20.log).
- Affected [retry report](evidence/project16-acceptance/p16-acceptance-node-retry.json)
  and [log](evidence/project16-acceptance/p16-acceptance-node-retry.log), with the
  original [blocked-file list](evidence/project16-acceptance/p16-acceptance-retry-files.json).
- Final [two-file report](evidence/project16-acceptance/p16-acceptance-first-run-retry.json)
  and [log](evidence/project16-acceptance/p16-acceptance-first-run-retry.log).

## Python contracts and limited source review

At `581ce369b235c0de21acd593a99b3566bf64a52b`, the first Python attempt reported
six tests and one error because Playwright was absent and workflow-loading
contracts could not import. This prior outcome is retained inside the
[contract report](evidence/project16-acceptance/p16-acceptance-python-contracts.json);
a separate first-attempt log was not supplied. Pinned `tests/requirements.txt`
dependencies were then installed with `--require-hashes` into
`/tmp/p16-python-deps`, without downloading a browser. The retry passed **13/13**
contracts. Its [raw log](evidence/project16-acceptance/p16-acceptance-python-contracts.log)
contains an intentional `fixture-browser` failure payload followed by unittest
`OK`; that payload is a failure-path fixture, not a real browser observation.
The same source's [AST report](evidence/project16-acceptance/p16-acceptance-python-ast.json)
records 12 changed Python files and zero syntax errors. Neither report records
a source tree or demonstrates browser execution.

At `0858f721e8e737e6bcca1365748409cb6b0b5f35`, the
[changed-source structure report](evidence/project16-acceptance/p16-acceptance-structure.json)
records 20 changed source files and zero introduced size or long-line violations.
Frozen `scripts/build.js` is 2,116 bytes with a maximum line length of 170; that
line is unchanged inherited text. This is a changed-scope review, not a global
strict-gate pass.

## Qualification boundary

The earlier [hosted qualification history](project16-hosted-qualification.md)
remains unchanged, including a3's three passing and five failing functional
suites. This archive establishes local affected-regression and contract
observations only. It does not establish corrected browser or standalone runtime
behavior, OS coverage, native permissions, physical keyboard/clipboard behavior,
assistive technology, or performance acceptance. Those require their own actual
runs with recorded source identity. Creating this evidence archive executed no
test, build, static gate, benchmark or browser.
