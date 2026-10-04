# Type-access reference plan

Implementation-ready; local validation is pending the scheduled serial slot.
The new context query reuses the owned lexical forest and canonical hierarchy;
it does not add name binding or another identity registry.

Eight authored tests cover top-level public/internal visibility, all six nested
flags, enclosing private containers, inherited caller privileges, distinction
from private member access, owned snapshots, foreign identities/cancellation,
explicit generic/interface unknowns and lexical/hierarchy budgets.

The authored ILAsm/ILVerify plan uses SDK10.0.201/runtime10.0.5 and fourteen
independent assemblies. Each verifies one Test method containing a castclass
type use; invalid inputs are never executed. Twelve decisions are expected
known agreements. Two negative family cases remain explicitly unknown because
the local adapter cannot resolve their external System.Object ancestry.
Negative native cases must report TypeAccess, not an unrelated verification
failure. The capture retains raw attempts before parsing, tool/source/assembly
hashes and actual adapter results.

```sh
node scripts/limited.js node tests/fixtures/a03-type-access/capture.mjs tests/fixtures/a03-type-access/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-type-access.test.js tests/a03-07-nested-access.test.js
```

At the granted slot, run native capture and focused/affected member contracts
serially, then compare exact dependency 4d269c80 (same product as 99ae5455) against the candidate with the
unchanged benchmark-member-access.mjs and benchmark-nested-access.mjs controls.
Measure new type queries with benchmark-type-access.mjs. Retain chronological
samples, medians/p95 and sampled heap deltas without allocation or significance
claims, then required static/structure checks. Broader native/browser/Rust and
whole-verifier qualification remains staged.
