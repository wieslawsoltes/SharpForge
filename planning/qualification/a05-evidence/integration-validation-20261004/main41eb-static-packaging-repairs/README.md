# Focused supply, packaging and static follow-ups

These three commands passed at the exact revisions below. They are additive
evidence following the [failed 9a4b cohort and static check](../main41eb-9a4b/README.md),
whose original output remains unchanged. They do not establish a passing full
A05 run, a full-asset build or a release qualification.

| Run | Tested commit | Result | Reported test time | Wall time |
|---|---|---|---:|---:|
| Supply unit | `bb66ca2bb27bad05b29cc9e5072355f50337b682` | 12 passed, 0 failed, 0 skipped | 370.753337 ms | 0.5017246429997613 s |
| Evidence packaging | `63f6134b51882b88336428d0699bff42a4fde74d` | 5 passed, 0 failed, 0 skipped | 980.326699 ms | 1.1595788030026597 s |
| Static check | `63f6134b51882b88336428d0699bff42a4fde74d` | Exit 0; static gate passed | Not a test run | 8.57350302800478 s |

The supply run used tree `ce1383432001dab0d18a229feb811e8537da05e6`.
Packaging and static checks used tree `66e422f49400126898cd5072df97c0da96f1c2e5`.
Every journal records the same clean identity before and after its command.

## Exact records

| Execution record, including complete ordered argv | Original output |
|---|---|
| [Supply execution JSON](supply-unit-bb66-execution.json) | [Supply TAP](supply-unit-bb66.log) |
| [Packaging execution JSON](packaging-63f6-execution.json) | [Packaging TAP](packaging-63f6.log) |
| [Static execution JSON](static-63f6-execution.json) | [Static check log](static-63f6.log) |

All six files are byte-identical copies from
`/workspace/scratch/42f7738360b9/a05-main41eb-validation-20261004/`.
[manifest.json](manifest.json) records their sizes, SHA-256 digests and original
paths, and the relevant tested source blobs and hashes. Each execution record
retains timestamps, environment, Node version and start/end identity.

The commands ran in `/tmp/a05-integration-42f7738360b9` using Node `v24.19.0`
through `scripts/limited.js`, with one parallel run, one concurrent test file
and a 512 MiB V8 cap. Outer `NODE_OPTIONS` was unset. Test runs explicitly used
`--test-concurrency=1 --test-reporter=tap`; the static command was `npm run check`.

## Scope and limits

The supply unit run executed `tests/conformance/supply/gates.test.js`. Its 12
tests cover synthetic fixture assets, vendor reconstruction, secret scanning,
bounded reads, seals, attestation identity, SBOM inventory and linked-path
rejection. This resolves the earlier local missing-input interruption for this
unit suite. The test file, tracked `public-fixtures.json` input and
`license-gate.js` have identical Git blobs at 9a4b, bb66 and 63f6; those
comparisons are recorded in the manifest. This is not a complete release
asset/license scan or verification of built release payloads.

The packaging run executed `tests/a05-evidence-packaging.test.js` and
`tests/a05-evidence-origins.test.js`. It checks actual capture declarations and
negative asset boundaries, the small shipped documentation index, preservation
of relocated evidence bytes, archived drivers remaining outside executable
module discovery, and rejection of forged or cyclic relocation identities.
It does not build or measure the complete product.

The static run reported 30 manifest areas, 1,347 Node files, 38 browser scripts,
zero unassigned files and zero duplicate owners. It checked **4,797 JavaScript
modules with zero syntax errors**. The dynamic-code gate passed with **4,741
inspected files, 4,788 modules and zero errors**. The three historical drivers
are now retained as text evidence; the dynamic-import allow-list was updated
for the reviewed historical size reader. The size reader's source blob itself
is unchanged across the three recorded revisions. No static check was waived.

Clean Git identities do not independently establish complete materialization
of every sparse-checkout asset. No full-asset release build, full A05 suite,
browser, numeric/performance or cross-platform qualification is claimed here.
No command was rerun while creating this archive.
