# CIL execution budget and admission limits

## Original failure

The integrated replay at `43fa19c425700e1c4703190f100239c06dd97a75`
produced three `IL_EH_FLOW` issues with diagnostic `CILR0001`:

- Extension iterator, closure and chained extension properties.
- Local iterator with captured state and a finally block.
- The pinned `by-reference/ref-out-in-parameters-share-the-variable` fixture.

`canonical-consumer-first.log.gz` preserves the complete original 74,196-byte log
losslessly. Its uncompressed SHA-256 is
`7b57bbfc9e2bc9528980283cd5d93a35b83074fa3d2e862fde4fc277be116b9b`.
The original launcher manifest is `canonical-consumer-first.json`.
`eh-failures.json` retains the three complete phase/error observations, including
source and assembly hashes. Other failures in the full log remain independent.

## Cause and correction

The replay helper explicitly supplied `maxInstructions: 20_000_000` to the CIL VM.
The VM forwarded the same options to its inspector and verifier. The EH region
builder interprets `maxInstructions` as a static method-size bound and rejects
values above 1,000,000 with `CILR0001`, before evaluating the method's EH geometry.
A low runtime budget also limited static decoding, causing rejection before the
execution budget could be enforced.

The runtime-owned `execution/cil-admission.js` seam removes only the execution
`maxInstructions` option from an owned copy used for CIL inspection and admission.
Initial admission and later synchronous callback verification share that rule.
Every other option keeps its original value and identity. The execution budget,
direct CIL API contracts, verifier checks and static ceilings are unchanged.
An existing `AssemblyInspector` retains its identity and inspection settings.
The existing registered CIL member, type and callback profiles are untouched.

The seam makes one copy proportional to the option count at admission, and one
when callback verification adds a new method. It adds no work per executed
instruction. Performance has not been measured for this source checkpoint.

## Qualification status

The new `tests/a05-cil-admission-budget.test.js` controls are source-only until a
scheduled run is recorded. They cover actual finally execution, nested fault/catch
execution through a selected method, budgets above the verifier ceiling, a low
execution budget, direct verifier bounds, malformed EH rejection, cancellation,
and late callback verification with both successful and rejected admission.

The original three integrated failures must be replayed independently. Fixing
their admission option collision does not establish iterator/BCL or by-reference
execution support; a later execution or profile failure must remain a failure.
