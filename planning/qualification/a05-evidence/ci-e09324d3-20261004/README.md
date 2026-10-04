# A05 first complete remote matrix — 2026-10-04

These are the original CI observations for pushed commit
`e09324d3e83d742d47eb39b8f0482c38dc0f8756`, tree
`3322938bc25bfd2ba108ffdc77f1202aa2dabbb8`. This archive records failures as well as
passes. Later fixes do not retroactively qualify this revision.

| Native cell | Architecture | Resolved SDK | Passed | Failed | Unsupported |
| --- | --- | --- | ---: | ---: | ---: |
| Ubuntu | x64 | 8.0.425 | 20 | 9 | 3 |
| Ubuntu | x64 | 10.0.201 | 21 | 11 | 0 |
| Windows | x64 | 8.0.425 | 21 | 8 | 3 |
| Windows | x64 | 10.0.201 | 22 | 10 | 0 |
| macOS | arm64 | 8.0.425 | 20 | 9 | 3 |
| macOS | arm64 | 10.0.201 | 21 | 11 | 0 |

Every native job failed after successful setup. The three SDK 8 unsupported cases
are the explicitly excluded numeric conversion, capture and replay policies;
they are not passes. The original varargs results remain **failed** on Unix and
passed on Windows. A later observed-target policy must not rewrite these reports.

| Browser | Passed | Failed | Failure |
| --- | ---: | ---: | --- |
| Chromium | 7 | 0 | None |
| Firefox | 4 | 3 | Official Speedscope import timed out in all three VM routes; console logs record WebGL setup failure. |
| WebKit | 6 | 1 | The CSP-denial monitor did not observe its expected violation event. |

Browser reports retain each case separately: Wasm execution, debugger deoptimization,
profile exports, CSP fallback, and source/reloaded/CIL Speedscope imports. A passing
session log alone does not override a failed case in `report.json`. In particular,
the WebKit case failed after its browser session ended. The original revision did
not collect the graphics/native-compile probes introduced by later repairs.

The repository `Validate SharpForge` core job failed `npm run check` because
`tests/byref-gc-stress.test.js`, `tests/fixtures/a05-browser/test_contract.py`,
`tests/numeric-differential.test.js`, and `tests/preemption.test.js` were unassigned
to test manifests. Dependent qualification jobs were skipped and `ci-ok` failed.
`core-job.log` is the complete fetched job log, preserved without filtering.
Unlike the focused push jobs, core checked out GitHub's PR merge revision
`9d570ca54e0f4842eb7c9e42730af8287fa7ebf9`, whose parents are main `19755847…`
and pushed head `e09324d3…`. The commit API confirms its tree is exactly the same
`3322938b…` tree. Its small environment artifact is retained in `core-artifact/`.

## Authoritative records

- [Native run 37219653301](https://github.com/wieslawsoltes/SharpForge/actions/runs/37219653301)
- [Browser run 37219653508](https://github.com/wieslawsoltes/SharpForge/actions/runs/37219653508)
- [Repository validation run 37219655452](https://github.com/wieslawsoltes/SharpForge/actions/runs/37219655452)
- [Manifest and retained-file hashes](manifest.json)

Each native directory contains its unmodified aggregate `qualification.json` and
all failed/unsupported case result files. Failed case stdout, stderr and detailed
qualification reports are retained. The latter preserve native output where the
runner reached that assignment, VM output/faults, exact commands, source hashes,
assembly hashes and errors. For native processes that terminated by a disallowed
signal before the assignment, the original stderr is retained in the error record
and process exit/signal in its commands; absent fields have not been invented.

`fixtures/` retains the exact failed-case C# inputs and authored expected traces,
deduplicated across cells only when their bytes match. Original reports retain
their original paths. SDK 10 capture provenance, generated C# inputs and short
reference traces are included; large numeric oracle
payloads remain in the original artifacts. SDK versions identify the compiler
selection; the installed runtime list does not establish an exact guest runtime patch.

Browser directories retain the unmodified report, actual Speedscope JSON exports,
all available session and console diagnostics, DOM/table observations and PNG
screenshots. For Firefox, see `speedscope-source/screenshot.png` and its sibling
console log, with corresponding reload/CIL files. No WebKit CSP screenshot was
produced by this failed revision. The Speedscope release manifest records the
official third-party asset hashes; executable/UI assets are not duplicated here.

The nine native/browser artifact ZIPs and the core artifact ZIP were downloaded and their SHA-256 values checked
against GitHub's upload digests. Artifact IDs, URLs, sizes, digests, job IDs and
individual retained-file hashes are in the manifest. Raw ZIPs, Playwright trace
ZIPs, generated DLLs and bulk oracle payloads remain in the original workflow
artifacts and the external archival workspace. GitHub's configured artifact
retention is 14 days; those external payloads are not guaranteed permanent by this
compact Git archive. No source, DLL, expected output or report was regenerated to
produce the evidence here.
