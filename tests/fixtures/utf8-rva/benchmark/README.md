# UTF-8 compilation benchmark — 2026-10-04

This is the single scheduled paired run for SF-A02-T77 / #658. The measured baseline is
`bf85020e6024cdd679a0234d9f050ca7dedddf53`; the qualified candidate is
`41972f6bff4704c5e7597387cfda45f89c3670db`. The intervening commits are recorded in the raw report
and contain only the isolated UTF-8 implementation, its required signature/diagnostic corrections, and qualification.

The host was Linux x64, Node v24.19.0, AMD EPYC 9V74, with nine logical CPUs visible and
10,451,464,192 bytes of memory reported by Node. The reference pack was .NET 10.0.5 / net10.0, 167 assemblies.
The coordinator reserved the serial validation slot for this run; other agents did source work only.

```sh
DOTNET_ROOT=/workspace/scratch/1692a10afba9/toolchain/dotnet \
node scripts/limited.js node --expose-gc packages/compiler/bench/utf8-rva.bench.js \
  --baseline /workspace/scratch/1692a10afba9/utf8-benchmark-baseline \
  --warmup 80 --samples 24 \
  --output /workspace/scratch/1692a10afba9/utf8-benchmark-raw.json
```

The benchmark script and its exact existing static-import allowlist entry were unchanged:
`84e5538c58b562bde3c86ea5a06bc642bb26f412cdbfad902fe25f4e280dd43f`, one dynamic import.
Both tracked trees matched their immutable HEADs before and after the run. All ten transitive packages
and sixteen dependency edges resolved inside their selected checkout. Before/after alias and entry hashes
were identical; the actual Node public-entry resolver check is retained separately. No compiler library was
shared across revisions. The temporary baseline was an 8.3 MB sparse checkout and was removed after verification.

Every fixture declares 48 methods. The UTF-8 fixture has twelve distinct texts, with ASCII, multibyte Unicode,
and repeated literals. The matched control returns default spans and has no literal storage. Each revision
has its own registry symbols and its own reference set decoded from identical PE bytes. Cached-reference
compilation excludes pack reading, decoding, and initial cross-assembly binding. All eight cases receive
80 interleaved warmup rounds followed by 24 measured rounds. The first case rotates each round, balancing
all positions. Raw warmups and all measured samples are retained. This is not a cold-start measurement.

| Mode | Fixture | Median ms, before → after | Change | p95 ms, before → after | Change | PE bytes, before → after |
|---|---|---:|---:|---:|---:|---:|
| registry | utf8 | 13.788 → 6.047 | -56.14% | 19.781 → 13.262 | -32.96% | 22,016 → 5,632 |
| registry | noUtf8 | 4.772 → 4.862 | +1.90% | 13.654 → 8.442 | -38.17% | 3,584 → 3,584 |
| cachedReferences | utf8 | 12.557 → 7.152 | -43.05% | 25.007 → 12.190 | -51.25% | 22,016 → 5,632 |
| cachedReferences | noUtf8 | 5.017 → 6.985 | +39.22% | 9.640 → 12.206 | +26.62% | 3,584 → 3,584 |

UTF-8 output size decreased by 74.42%; the control output size was unchanged. The registry control median
increased by 1.90%. The cached-reference control exceeded the 5% time budget: its median increased by
39.22% (1.968 ms), and p95 increased by 26.62% (2.566 ms). These observations are retained without rerunning
until the numbers pass. The paired comparison does not isolate the cause of that control regression; it
must not be described as proven hashing cost, noise, or a generalized improvement.

**Implementation-author sign-off:** I accept the measured cached-reference control cost for this correctness
batch. The change preplans and emits actual static literal data, preserves the out-of-span NUL terminator,
uses real target constructor contracts and fallback behavior, and emits the readonly span signature that
the CLR requires. Its separately qualified native static-data modes allocate zero bytes per literal call.
The measured control regression remains a limitation of this candidate. This is an explicit correctness-cost
exception, not an overall performance-budget pass or a claim about larger applications.

Heap and ArrayBuffer differences below are process-memory deltas around each compilation. Natural GC can
make a delta negative; these are not allocated-byte counters or revision-specific retained-memory totals.
`summary.json` additionally retains p95, minimum, and maximum deltas, while the raw report retains each sample.

| Revision | Mode | Fixture | Median heap delta, bytes | Median ArrayBuffer delta, bytes |
|---|---|---|---:|---:|
| baseline | registry | utf8 | 10,778,492 | 511,627 |
| baseline | registry | noUtf8 | 4,050,024 | 49,087 |
| baseline | cachedReferences | utf8 | 11,469,152 | 511,627 |
| baseline | cachedReferences | noUtf8 | 4,493,524 | 49,087 |
| current | registry | utf8 | 4,561,980 | 88,538 |
| current | registry | noUtf8 | 4,208,208 | 49,087 |
| current | cachedReferences | utf8 | 5,031,108 | 88,538 |
| current | cachedReferences | noUtf8 | 4,646,252 | 49,087 |

Across all measured rounds together, after explicit GC at both boundaries, the process heap delta was
-2,969,240 bytes and the ArrayBuffer delta was -1,261,587 bytes. These mixed-case totals do not establish
a per-revision memory saving. The native test’s actual literal-allocation counts are documented separately
in the parent fixture README.

Correctness remains the previously qualified 12 focused tests plus 13 adjacent tests, zero skips, including
actual CLR execution in registry, actual-reference, and fallback modes. No correctness rerun, oracle repin,
or additional heavy suite was performed during this benchmark slot. All reports preserve the actual measured
candidate SHA; the following commit adds evidence and documentation only.
