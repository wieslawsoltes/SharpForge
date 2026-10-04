# Nested source emitter reference plan

Four C# inputs exercise try-in-finally, finally-in-catch, three-level nesting and
nested rethrow through the portable source-image CIL emitter. All source and
native/VM assertions are prepared and have not run before the scheduled slot.

The capture emits each assembly through the candidate, asks pinned ILVerify
10.0.5 to inspect exactly its entry method, then runs it on CoreCLR 10.0.5 and
compares stdout and exit status. SDK 10.0.201, pinned reference pack and checked
external tools use the existing oracle helpers. Raw decisions/execution output
and hashes are written before assertion, so mismatches remain available.

```sh
node scripts/limited.js node tests/fixtures/a03-emitter-regions/capture.mjs /tmp/emitter-regions-native.json
```

Set the tool environment from `tests/conformance/verifier/README.md`. The source
regression file can be copied with input.js to parent b6c4d52a to record failing
nested region order before the fix, without importing new implementation helpers.
Candidate focused validation includes both new test files, existing EH tree/writer
and CIL/canonical-replay suites. All local jobs must use the serial limiter.

The same `benchmark-emitter-regions.mjs` harness runs on exact parent and candidate
with its fixture input, retaining seven chronological samples after two warmups
for no-handler, flat-catch and nested cases. It records default-path effects and
new geometry cost; shared-host uncertainty and heap-delta limitations must be
reported with the eventual results. No performance result is claimed yet.
