# Generic TypeSpec correction: focused qualification

The corrected source at `a5150472de399a1abea85db4229ead415522cf7e`
passed the unchanged 30-file focused command once: **126 tests, 126 passed,
zero failed, canceled, skipped, or todo tests**. The process exited 0 without a
signal, interruption, inspection error, or stderr output. The recorded start was
2026-10-04T21:13:25.365503Z and completion was 2026-10-04T21:13:37.532224Z.

The source, alias, and historical-evidence snapshots before and after execution
are identical. The recorder checks seven package-source aggregates, 402 current
file pins, and 221 historical file pins. Its complete top-level TAP summary and
plan both report 126 tests. These are actual execution results, separate from the
source-only preparation and root review retained alongside them.

## What changed

`95aeeae35aa759e8a1a16f1893e1269580ebc778` limits a scoped TypeSpec's active
recursion marker to its awaited signature binding. Semantic graph completion
receives the incoming operation, preserving its nominal inheritance ancestry
while releasing the marker for the signature that has already finished binding.
The additional tests cover a valid non-generic self interface through both
TypeDef and direct TypeSpec entries, genuinely recursive self/mutual TypeSpec
signatures, and preservation of an actual nominal inheritance cycle rejection.

`a5150472de399a1abea85db4229ead415522cf7e` corrects the unload control. A
dependency that was not accepted before its context began unloading cannot be
newly resolved by a retry, and that retry must not reinvoke the provider. A
separate positive control fully completes the required dependency graphs before
unload and then constructs through a fresh host using the retained metadata.
Unexpected product rejection of a native-success operation now identifies the
case and operation while retaining the original error as its cause.

There are four additional authored tests in the same 30 files. The earlier
122-test command passed 119 and failed three. Its raw TAP, receipt, native
capture, and prior source remain in commit
`b6590e7cb1a106083eb65c9a9fb99d0f366b17f2` and the adjacent
`qualification-first-5be28e30` directory without modification. The preserved
diagnosis records the limits of the original unlabeled combined-case failure;
it does not invent an individually instrumented outcome for each old loop case.

## Native evidence and source binding

No new native capture was performed for this correction. The original isolated
CoreCLR 10.0.5 / SDK 10.0.201 capture remains the independent reference: 40
commands, 34 cases, 71 operations, 38 identity observations, and 14 images. It
recorded 43 returned operations and 28 `System.TypeLoadException` outcomes.

The existing strict replay still checks all 12 live oracle/tool source hashes
against the captured source, all pinned inputs, raw native outputs, journals,
and image identities. The capture's 70 product-source records remain historical
provenance for the source at capture time. No source-binding exception, translated
native result, missing-fixture fallback, or skip was added. The original native
execution and byte-for-byte retention receipts are explicit prerequisites of
this focused correction gate.

## Retained files and remaining work

The stdout, empty stderr, full execution receipt, plan, recorder, preparation,
root source review, and original marker diagnosis are copied byte-for-byte.
`retention.json` identifies every source and destination and records the
independent result verification. The recorder is retained with a `.py.txt`
suffix as evidence. Its original external path is recorded in the receipt.

This gate qualifies the corrected source for the specified focused scope. The
previously planned baseline controls, corrected controls, and new generic-service
measurements remain pending. Their driver, input fixtures, warmups, sample counts,
workloads, and correctness checks must remain unchanged. Full platform/browser
coverage and the separate constraint, variance, member-execution, dictionary,
and reflection work are not established by this focused result.
