# Type-access evidence

Product8b4e5b40 passed the scheduled serial qualification.
The new context query reuses the owned lexical forest and canonical hierarchy;
it does not add name binding or another identity registry.

Eight new tests cover top-level public/internal visibility, all six nested
flags, enclosing private containers, inherited caller privileges, distinction
from private member access, owned snapshots, foreign identities/cancellation,
explicit generic/interface unknowns and lexical/hierarchy budgets.

The captured ILAsm/ILVerify corpus uses SDK10.0.201/runtime10.0.5 and fourteen
independent assemblies. Each verifies one Test method containing a castclass
type use; invalid inputs are never executed. Twelve decisions are
known agreements. Two negative family cases remain explicitly unknown because
the local adapter cannot resolve their external System.Object ancestry.
Negative native cases must report TypeAccess, not an unrelated verification
failure. The capture retains raw attempts before parsing, tool/source/assembly
hashes and actual adapter results.

```sh
node scripts/limited.js node tests/fixtures/a03-type-access/capture.mjs tests/fixtures/a03-type-access/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-type-access.test.js tests/a03-07-nested-access.test.js
```

All 55 focused/affected contracts passed without skips. Static checks covered
3,330 syntax and 3,326 import modules with zero errors; manifests assigned 864
Node files and 36 browser scripts. Structure reported 271 existing findings,
none in changed paths. qualification.json retains exact commands and log hashes.
One limiter reservation ran all stages sequentially, concurrency1, Node1GiB.

Fixed paired controls compare exact dependency4d269c80 to product8b4e5b40 with
identical harness/input hashes. Seven chronological measured samples follow two
excluded warmups. Shared Apple M3 Pro/macOS26.6, Node24.21.0; no quiet-host claim.
Median/p95 microseconds:

| Existing control | Parent | Candidate |
| --- | ---: | ---: |
| Context construction | 42.274094 / 46.991531 | 42.794266 / 52.231766 |
| Cached member | 0.014544 / 0.026772 | 0.014407 / 0.060160 |
| Public access | 0.038193 / 0.056908 | 0.020182 / 0.056307 |
| Family access | 0.369466 / 0.494019 | 0.336874 / 0.394856 |
| Enclosing private | 0.214925 / 0.429321 | 0.222493 / 0.517700 |
| Denied private container | 0.168335 / 0.841553 | 0.179240 / 0.399658 |
| Enclosing family receiver | 0.481486 / 0.890259 | 0.522461 / 0.607910 |

Root integration review explicitly accepted every >5% regression: context p95
+5.240234 microseconds/+11.15%; cached-member p95 +0.033389/+124.72%; enclosing-private
p95 +0.088379/+20.59%; denied-container median +0.010905/+6.48%; enclosing-family
median +0.040975/+8.51%. The additive query reuses the owned forest, canonical
identities and shared bounded walk without another forest, identity registry,
query cache or flat lexical scratch. The review accepts these absolute measured
costs for that capability; it makes no causal attribution, noise, speedup or
significance claim. No repeated/selected benchmark was used.

New top-level, denied-container, enclosing-private and enclosing-family type
queries recorded median/p95 0.044922/0.045776, 0.159912/0.176555,
0.195964/0.623210 and 0.535319/1.360840 microseconds. performance.json retains all
measured samples, hashes, environment and acceptance. Heap deltas are not
allocation counts or peak memory. native.json retains raw tool output.
Broader native/browser/Rust and whole-verifier qualification remains staged.
