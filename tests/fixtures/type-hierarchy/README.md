# Cross-assembly browser hierarchy

Qualified #2574 scope, stacked on shared SHA-1 prerequisite #4488. Final product `0de8c5f9ad8c925f89bbee4f8132c6cd9c728c92`. Initial product
`abcf6f5651dc56954b3a455b1f84bfbec8343e43` began qualification at `f64097ea1`;
`2f51cbc0c24c307f7bcade794087338f64ea3689` corrected only a fixture setup.
[Exact revisions, dependency proof and phase results](qualification/qualification.json),
[raw fixed measurements](qualification/performance.json), [checks](qualification/checks.txt),
[browser report](qualification/browser-results.json), and [serial driver](qualification/driver.mjs.txt)
are retained. The final opt-in name-lookup change and its complete second fixed
schedule are documented below; neither initial samples nor failures were replaced.

## Behavior and reference evidence

The eleven hierarchy groups cover actual cross-image/nested binding; expected
base/derived/interface-implementer sets; missing/ambiguous assemblies/types;
version/culture/full-key/token identity; cycles and wrong kinds; exact/minus-one
count/name/key budgets; malformed heaps/coded tokens; cancellation and owned
returns after input destruction. A caller iterator/map cannot change the numeric
assembly snapshot. The old `d1fc86688` fails that regression meaningfully; its
[output](qualification/snapshot-regression-before.log) is retained.

`input.mjs` is authored CLI metadata, including intentionally baseless classes;
it is not claimed to be Roslyn-generated or executable. Declared-key mismatches,
ambiguity policy, malformed metadata and missing images are authored scenarios.
They do not claim CoreCLR unification or signature authentication behavior.

`native.json` is an actual two-assembly reference: `Hierarchy.A.cs` defines the
base, interfaces and nested type; `Hierarchy.B.cs` defines their cross-image
consumers. The pinned capture runs Roslyn twice, then CoreCLR reflection once.
All eight public type identities, base targets (including the nested external
TypeRef) and interface-implementer sets match Node and all three browsers.
Removing A produces a dead-reference node. SDK 10.0.201, .NET/reference pack10.0.5,
Roslyn5.3.0-2.26153.122; exact compiler/reference/source/image hashes and raw native
stdout/stderr/commands are in the capture. A SHA-256 is
`98465fddaa0c725e5f3fbfd30929198a4b6b70f4ca5ede5bae1edb3c6f938d74`; B is
`5ef193484635ce26483270776e4c4593e3ae8580f684d185a91658b66bf8abbe`.

The independently retained `../clr-type-graphs/native-graphs.json` is also reused
for **local** hierarchy parity. Its image hash is
`6f2ba4d03f35bb7b4be65463c2f6bc19fd9451da21a695ce3ccf8a66b504131a`.
It is not the evidence for cross-image binding.

## Serial validation

All local work used one outer limiter with Node24.21.0, concurrency1, maxruns1,
heap1024MiB, on shared macOS26.6 arm64. Parent SHA-1/PDB tests52/52 passed. Child
initial50/51 retained one fixture error: duplicate nesting was rejected by the
existing inspector before the intended hierarchy guard. Injection into already-
parsed metadata corrected the setup without weakening the assertion or changing
product code. Corrected hierarchy11/11 and the other unchanged40 affected tests
pass, including existing local/nested name-index callers and captured CLR parity.

Parent syntax3628/static3624 and child syntax3636/static3632 pass with no errors;
all manifests are assigned without collisions. Structure reports272 inherited
findings, none in owned changes. No native retry occurred. The subsequent product change received exactly one
fresh fixed benchmark schedule; both schedules and all samples remain available.
Chromium153.0.8010.12, Firefox155.0 and WebKit26.6 each passed three focused groups
(shared SHA-1/WebCrypto, authored bounds/ownership, actual two-image native trees).
Python3.14.7/Playwright1.63.0; CSP enabled; all browsers/server/thread closed.

## Fixed measurements

One20-pair alternating-order schedule retained all160 chronological observations,
with three fixed warmups per case/variant and no excluded samples. Existing
controls compare `440c4ade9` against the candidate, each with its own CIL and
symbols source; other packages/manifests share only proven-identical hashes.
Fixture bytes are identical between variants. SHA-1 has100 iterations/cell on
16KiB, local/nested adapter construction plus resolution100/cell. New paths use
one operation/cell over20 modules and971 TypeDefs (950 children of one base).
Inspectors and symbol index are prepared outside the new-path measurements.

| Milliseconds per operation | Before median/p95 | After median/p95 |
| --- | --- | --- |
| SHA-1 | .190983545 / .197391250 | .187820210 / .201250000 |
| Local adapter+resolve | .035813750 / .045775410 | .036671870 / .042179580 |
| Nested adapter+resolve | .032513125 / .040610830 | .035192710 / .041497080 |
| New graph construction | unavailable | 2.459521 / 3.204042 |
| New951-node derived tree | unavailable | .584708 / .879042 |

Nested median increases .002679585ms (+8.2415%); p95 increases .00088625ms
(+2.1823%). This initial observation prompted a concrete source review, which found the
new key-lookup closure was being created for existing callers that do not use it.
Other existing controls are within5%. There is no speedup, significance, shared-
host causal explanation or measured peak allocation claim. Storage counters are
logical input-occurrence charges/counts, not actual JavaScript heap ceilings.

## Final opt-in lookup correction

`0de8c5f9a` adds `includeKeyLookup=false` to the internal name index. Its default
return shape and closure count match the original local/nested adapter path;
only the new hierarchy binder opts into raw keys and the lookup closure. The
same bounded cache/index is reused. This avoids allocating the new closure for
old callers; it is a source-level fact, not a measured peak allocation claim.

The serial follow-up reused the installed, hash-verified dependencies and
immutable baseline, and replayed both captured native images without any native
rebuild. All51 affected tests pass, the same three browsers pass, and checks
again report3636 syntax/3632 static modules with no errors and272 inherited
structure findings/none owned. [Final tests](qualification/final/child-focused.log),
[checks](qualification/final/checks.txt), [browser results](qualification/final/browser-results.json),
[fixed160 observations](qualification/final/performance.json), and
[driver](qualification/final/driver.mjs.txt) preserve exact commands/revisions.
No unchanged retry, sample exclusion or tuning occurred.

| Final milliseconds per operation | Before median/p95 | After median/p95 |
| --- | --- | --- |
| SHA-1 | .180099380 / .185560420 | .179431250 / .183542500 |
| Local adapter+resolve | .030421040 / .043473340 | .031900205 / .033976250 |
| Nested adapter+resolve | .027843545 / .036056670 | .031468130 / .040040830 |
| New graph construction | unavailable | 2.120875 / 2.428583 |
| New951-node derived tree | unavailable | .522500 / .557667 |

Final nested median increases .003624585ms (+13.0177%) and p95 .003984160ms
(+11.0497%). Other existing controls are within5%. Root disposition of this
remaining measured tradeoff is pending. No improvement is claimed from comparing
the two runs; the shared-host observations do not establish causality, significance
or a noise explanation. All320 observations remain committed.

## Limits

TypeSpec constructed-base substitution, forwarding, ModuleRef/netmodule/nil-scope
binding and retargeting produce explicit unresolved diagnostics. This graph is
nominal metadata browsing, not constructed assignability, access checking or
runtime execution. Windows/Linux, sourceVM/directCIL/Rust/Wasm execution, Studio
build and full matrix were not run or implied by the focused browser/CLR evidence.
