# Definite local initialization qualification

This is the optional ECMA definite-assignment policy of `verifyCilMethodTypes`;
portable mode continues to require InitLocals. It does not execute IL or qualify
constructor state, alias initialization, EH or byref lifetimes. #2405 remains open.

Implementation and authored tests are complete; **qualification is pending** in
the root serial queue. No native, browser, benchmark or check result is claimed.

The fixed 24-case corpus covers stores, unset reads/addresses, branch intersections,
loops, switch, independent bitset words and primitive/reference/byref storage.
Positive no-InitLocals loads use ECMA III.1.8.1.1's explicitly optional analysis;
ILVerify 10.0.5 rejects them. Those differences are declared before execution and
are not native parity or oracle defects. Native captures retain exact PE hashes,
input hash, tool versions and full observations.

Planned serial commands at a frozen committed head:

```sh
node tests/fixtures/verifier-initialization/capture.mjs tests/fixtures/verifier-initialization/native.json
node --test --test-concurrency=1 tests/a03-local-initialization.test.js tests/a03-numeric-transfers.test.js tests/a03-verifier-dataflow.test.js tests/a03-verification-types.test.js
node packages/cil/tools/benchmark-numeric-verifier.mjs /tmp/numeric-control.json
node packages/cil/tools/benchmark-local-initialization.mjs /tmp/initialization.json
npm run check
npm run check:structure
```

The entire driver, including installs, native, browsers and all commands, owns
one outer `scripts/limited.js` slot with Node24, concurrency1/maxruns1/heap1024MiB.
The numeric control runs unchanged on exact baseline/head. Every fixed sample is
retained; first3 of12 per cell are designated warmups before any measurement.
New-feature cold and cached costs are separate from existing-operation regressions.
Heap deltas describe process observations, not allocation counts or peak memory.
Chromium, Firefox and WebKit run the source-module browser corpus one at a time.
