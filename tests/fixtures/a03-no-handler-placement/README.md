# Handler-only instructions without EH clauses

Qualified follow-up to #4380, under partial #2407. Product `094e8bcde` is
unchanged; later commits correct only reference-tool evidence handling.

`verifyCilAssembly` now uses the existing lexical opcode-placement registry for
methods with no EH clauses. `rethrow`, `endfinally` and `endfilter` receive
`IL_EH_FLOW` with the existing `CILCF0001`, `CILCF0004` and `CILCF0005` diagnostics.
The error includes the byte offset and method token; stack propagation and
capacity proofs are withheld. Unreachable instructions follow the standalone
lexical validator's same rule. Filters remain inspection-only.

The small internal empty-region seam shares the placement functions; it does
not construct a tree or cursor and is not exported by the package entry point.
Validation is fused into the existing offset-index pass, O(instructions) time
and O(instructions) index storage. Direct Map writes replace temporary pairs
on this path. There is no new instruction scan, PE reread, decoder, allocation
per placement check or handler-bearing validation change. Existing bounds on
inspector decoding still apply; EH-specific budgets remain bypassed when no
clauses exist. Allocation design is not a measured peak-memory claim.

Four passing tests cover rejected reachable/unreachable placement, diagnostic
parity, withheld proofs, ordinary return/throw/branch behavior, cached decoded
records and mandatory source/image-provenance validation of native observations.
Six ILVerify cases were captured: three ordinary positive bodies and three
handler-only negative bodies. The pinned SDK/runtime/tool helpers and parser are
reused; captures preserve raw output before assertions and never execute invalid
assemblies. The captures found ILVerify 10.0.5 crashing for `endfinally`
without a handler and `endfilter` without a filter: its [pinned implementation](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/tools/ILVerification/ILImporter.Verify.cs#L2186)
checks HandlerIndex/FilterIndex non-fatally, then dereferences the absent value. The exact
Nullable/ImportEndFinally and Nullable/ImportEndFilter failures are retained as unavailable reference evidence,
never counted as a native rejection. Other invocation failures still stop the
capture. The product rejection remains required by the independent placement
rules and focused tests, following ECMA-335 III.3.34–35. Four other native outcomes
agree. The stopped captures remain in native-initial-failure.json and native-endfilter-failure.json.

The named regression fails against baseline `8336790a`. All 174 combined
affected tests pass, including these four new contracts; static checks inspect
3377 syntax/3373 static modules with zero errors. Structure reports 271 existing
findings and none added. [Qualification](qualification.json) retains the expected
failure and terminal checks; [native.json](native.json) records four native
agreements, two unavailable oracle results, and independent admission assertions
for all six cases. No crashed invocation is counted as a native rejection.

[Performance](performance.json) retains all 12 chronological samples per case.
One fixed baseline → #4380 → #4414 schedule used concurrency 1, a 1 GiB heap and
one outer limiter at a time. Parent → child median/p95 milliseconds per 1000
admissions: no EH 3.338417/4.031500 → 3.289209/3.608625; catch
7.860500/10.441417 → 8.402625/8.907458; finally 6.866958/8.824500 →
5.855542/6.822667. Root review accepts catch median +0.542125 ms/+6.90%
(~0.542 µs/admission) for completed shared placement validation. No other
existing median/p95 regresses. The shared-host samples establish no significance,
causal attribution, noise explanation, speedup or peak-memory claim. Broader
engines/platforms and typed catch/filter/member access remain separate.

```sh
node scripts/limited.js node tests/fixtures/a03-no-handler-placement/capture.mjs tests/fixtures/a03-no-handler-placement/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-no-handler-placement.test.js
```
