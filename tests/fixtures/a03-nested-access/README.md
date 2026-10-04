# Nested member-access evidence

Product99ae5455 passed the scheduled serial qualification.
This extension reuses the canonical member/type context and bounded inheritance
relations. It adds an owned lexical parent forest, not a second name resolver.

Nine focused tests cover enclosing-to-nested direction, sibling isolation, all
six nested visibility flags, protected receivers through an enclosing derived
caller, private containing types, owned snapshots, identity/cancellation, raw
RID/duplicate/cycle/visibility rejection, depth64/65 and aggregate work limits.
The previous eight flat-access tests remain, with former nested unknown cases
updated to their now-defined positive outcomes.

The captured native corpus uses pinned ILAsm/ILVerify10.0.5 and SDK10.0.201: 24
independent assemblies, fields and methods across twelve lexical access cases.
Twenty-two queries are known agreements, and the two invalid protected
base-receiver cases remain explicit unknown because System.Object is unresolved
by this local adapter. Only the single Test method is verified; no invalid case
is executed. Raw attempts are written before parsing, with tool/source/assembly
hashes and actual query outcomes retained by the capture.

```sh
node scripts/limited.js node tests/fixtures/a03-nested-access/capture.mjs tests/fixtures/a03-nested-access/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-nested-access.test.js tests/a03-07-member-access.test.js
```

All 47 focused/affected contracts passed, without skips. Static checks covered
3,326 syntax and 3,322 import modules with zero errors; manifests assigned 863
Node files and 36 browser scripts. Structure reported 271 existing findings,
none in changed paths. Exact commands and log hashes are in qualification.json.
One limiter reservation ran all stages sequentially, with concurrency1 and a
1 GiB Node heap cap. No other team heavy job ran concurrently.

The fixed paired controls compare parent8ae8188b to product99ae5455 with identical
benchmark-member-access.mjs and fixture hashes. Seven chronological measured
samples per case follow two excluded warmups. Shared Apple M3 Pro/macOS26.6,
Node24.21.0; no quiet-host or significance claim. Median/p95 microseconds:

| Existing control | Parent | Candidate |
| --- | ---: | ---: |
| Context construction | 41.806641 / 47.628906 | 40.932297 / 44.877594 |
| Cached member | 0.014175 / 0.023707 | 0.014236 / 0.023671 |
| Public access | 0.037735 / 0.114319 | 0.018232 / 0.041801 |
| Family access | 0.321045 / 0.432617 | 0.333944 / 0.563191 |

Root integration review explicitly accepted family p95 +0.130574 microseconds
(+30.18%) and median +0.012899 (+4.02%) for bounded nested caller/target visibility
and protected-receiver support. Flat queries retain no lexical scratch allocation;
the owned forest and query limits are explicit. No repeated or selected run was
used. Other controls recorded no >5% regression. No speedup, noise or causal
claim is made; sampled heap deltas are not allocation counts or peak memory.

New enclosing-private, denied-private-container and enclosing-family queries
recorded median/p95 0.217692/0.226521, 0.165080/0.179851 and 0.473674/0.634685
microseconds. All measured samples, environment, hashes and acceptance are in
performance.json; native.json retains raw tool output. The broader
browser/Rust/full verifier matrix remains staged; no full verification,
external binding or generic nested access claim.
