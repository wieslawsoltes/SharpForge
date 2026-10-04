# BCL native oracle corpus

This corpus contains 200 authored behavior cases: 40 each for string, formatting,
collections, math, and time. Capture requires all five families. Each case runs
under both invariant and `fr-FR` culture. `Common.cs` emits one JSON line per case,
with scalar values formatted canonically and exception types recorded without
localized messages. Formatting cases explicitly request the culture being measured.
Family catalogs declare case identities, positive/negative/boundary categories,
and expected exception types; they do not contain invented native outputs.

Capture manually from a committed checkout with the existing pinned oracle SDK:

```sh
node scripts/conformance/oracle/bcl-run.js --output artifacts/results/bcl/report.json
```

The output path must be new. The runner reuses `compileFixture` and `clr-run`:
each family compiles twice, then runs twice per culture. Compilation drift,
execution drift, unexpected exceptions, incomplete output, and process failures
fail capture. The report retains exact source/catalog hashes, assembly identity,
compiler diagnostics, raw native output, commands, culture and actual toolchain /
platform provenance. Non-pinned targets report unsupported without execution.

A complete capture contains 400 case/culture observations; its repeated executions
check stability without counting as additional behavior cases.

A captured report is not a qualified expected baseline. Root owns serial native
capture and platform qualification after the complete corpus has been authored.
