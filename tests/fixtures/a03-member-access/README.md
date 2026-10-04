# Member-access reference evidence

Qualified at `a467e217` on macOS arm64. All eighteen native cases matched the
plan: sixteen known queries agree, and two negatives remain explicitly unknown.
`capture.mjs` uses the existing pinned ILAsm/ILVerify 10.0.5 tools and .NET SDK
10.0.201 reference pack. Eighteen isolated assemblies cover public, private,
assembly, family-or-assembly, family and family-and-assembly for fields/methods,
including protected receivers and static family access. Only the named Test
method is verified; no fixture is executed. Source/assembly/tool hashes and raw
assembler/verifier output are retained before assertions.

Sixteen queries agree as known booleans. Two rejected native
base-receiver cases deliberately remain unknown in this adapter: their external
System.Object root is unresolved. Those are recorded separately, not counted as
proved rejections. CompilerControlled Def identity and nested/interface unknowns
are covered by focused metadata tests; this capture does not claim native support
for those cases or full instruction verification.

```sh
node scripts/limited.js node tests/fixtures/a03-member-access/capture.mjs tests/fixtures/a03-member-access/native.json
node scripts/limited.js node --test --test-concurrency=1 tests/a03-07-member-access.test.js
```

Set tool environment as documented in `tests/conformance/verifier/README.md`.
The snapshot fixture uses a closed local hierarchy to prove both positive and
negative ancestry independently of external-name resolution. Native assembly
queries use their actual metadata, preserving unresolved-root uncertainty.
The same benchmark harness measures exact-parent/candidate context construction
and existing member resolution, and candidate-only public/family access queries,
with raw chronological samples. The retained measurements are below; they do not establish a general speed or memory improvement.


Validation passed 38/38 focused tests, including all eight new access tests plus
member resolution, metadata hierarchy, merge relations and coded-index bounds.
`npm run check` passed 3,269 syntax modules and 3,265 import checks with zero
errors. Structure reported 269 existing findings, none in this change.
The first native attempt used Windows-style ILAsm options on macOS and stopped;
[`native-initial-failure.json`](native-initial-failure.json) retains its raw output.
The capture now selects the platform option prefix; product code was unchanged.
[`native.json`](native.json) retains successful tool output and observations.

The exact-parent baseline is `ea916a9c`; candidate is `a467e217`. Both used the
same fixture/harness, Node 24.21.0, Apple M3 Pro, macOS 26.6, a 1 GiB heap cap,
and the sole scheduled team job under the machine limiter. The host is shared.
Two warmups precede seven chronological samples; p95 is their maximum. See
[`performance.json`](performance.json) for every sample, environment and command.

| Operation | Parent median / p95 (µs) | Candidate median / p95 (µs) |
| --- | ---: | ---: |
| Context construction | 38.571625 / 42.319016 | 36.137359 / 40.622406 |
| Cached member query | 0.013974 / 0.023033 | 0.013771 / 0.023343 |
| New public access | — | 0.018033 / 0.035255 |
| New family access | — | 0.308390 / 0.326660 |

Existing controls stay within the 5% regression budget; cached-member p95 rose
1.35%. These bounded observations carry shared-host uncertainty and make no
speedup, causality or statistical-significance claim. Raw heap deltas are sampled
heap growth, not total allocations, retained memory or peak RSS. No full browser,
Rust or native execution matrix was run; this slice is a CIL metadata query and
the native reference verifies only the selected access method.
