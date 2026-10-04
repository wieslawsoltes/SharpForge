# Cross-assembly definition index

Qualified #2571 product `fff74bfa750eb38d9aa49cdd1498d35219ca15ad`, harness
`3013d7752bf7834d72ec5d5fbba60d53d2935071`, against main baseline
`bf5ed78110a864d9771849ac7845f0139d1986c4`. Final evidence changes no product/test
or harness source.

## Scope and results

**15/15** focused tests pass: seven new index tests and eight existing inspector
navigation tests. The baseline assertion proves the new API is absent before this
feature; it is an API-availability proof, not a claim of an older incorrect result.
The 20-assembly fixture contains 20,120 definitions and proves stable MVID/token IDs
across reload. Tests cover five definition kinds, nested types, MethodPtr ownership,
owned snapshots, exact/minus-one count/storage limits, cancellation, duplicate MVIDs,
corrupt ownership, raw token aliases, no signature/body decoding, and empty/end/zero
pages. A zero-limit page returns `nextOffset: null`, consistent with inspector pages.

One focused browser round passed five groups in each of Chromium 153.0.8010.12,
Firefox 155.0 and WebKit 26.6 on macOS 26.6 arm64 (Python 3.14.7, Playwright 1.63.0).
It served source modules with CSP/import-map and closed every engine/server.
[Browser report](qualification/browser.json) records exact versions, module hash,
checks and reused native provenance. This is not a Studio, Windows/Linux or execution
backend qualification claim.

Native reference data was reused without a rebuild: SDK 10.0.201, Roslyn 5.3.0-2.26153.122
(`4d3023de605a78ba3e59e50c657eed70f125c68a`), CoreCLR 10.0.5, Release/optimized
UnnamedSlots PE. Node and browser checked its SHA-256 and recorded MethodDef tokens
and names against the retained native observations. Native code was not executed by
the index. The independent authored fixture covers all five definition kinds and
boundaries; this is not a native oracle for every indexed row.

Static/manifests passed: 3,571 syntax and 3,567 static modules, zero errors; 966 Node
files/37 browser scripts/30 areas, no missing or duplicate assignments. Structure
returned zero with 271 inherited reports and no owned browser/index/entry-point
findings. [Full logs](qualification/validation.txt) retain every phase including the
expected baseline failure. No unexpected failure, retry or sample exclusion occurred.

## Storage and performance

The 20-assembly/20,120-definition index reports 157,840 UTF-16 name bytes and 5,383,000
logical payload bytes under configured 256,000/6,000,000 caps. Exact/minus-one tests
prove rejection at these deterministic limits. These counters do not measure JavaScript
object/Map/array overhead, already-loaded inspectors, output pages or process heap.
No actual peak-memory or allocation improvement is claimed.

One fixed schedule on a shared Apple M3 Pro/macOS arm64 host with Node 24.21.0 retained
all 60 chronological samples in [performance.json](qualification/performance.json):
20 alternating AB/BA pairs for the existing inspector constructor, then 20 new index
samples. The constructor used 30 warmups and 100 calls/sample; the new index used 5
warmups and 3 builds/sample. GC ran before each sample; median is the mean of sorted
positions 10/11, p95 is nearest-rank position 19. There were no repeats or exclusions.

| Operation, milliseconds | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Existing inspector constructor | 0.147631455 | 0.126672085 | 0.201455410 | 0.196236250 |
| New index over 20 loaded assemblies | unavailable | 7.887757000 | unavailable | 9.257166667 |

The existing control is within the regression budget. These observations make no
speedup, significance, causal-noise or peak-allocation claim. Both variants resolve
their own CIL source; only byte-identical transitive package trees/manifests were
shared, proved in [configuration.json](qualification/configuration.json). Exact
source revisions, fixture hashes and benchmark hash are retained with the raw data.

## Reproduction and boundaries

`comparison.mjs.txt` is the exact standalone harness (copy to `.mjs` to run).
`browser.py <repository> <output>` uses its sibling module and records failures before
rethrowing. `fixture.mjs` is shared by Node, browser and benchmark. The scheduled
outer-limiter driver awaited every command's terminal result, with concurrency 1 and
heap 1024 MiB:

```text
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=1024 node scripts/limited.js node \
/tmp/sharpforge-a13-index-driver.mjs \
install baselineProof focused benchmark browser check structure
```

The index snapshots loaded metadata definitions, not arbitrary referenced or
constructed types. It adds no assembly resolver, search or usage analysis. Existing
inspectors parse/index metadata before this API is called; their memory is excluded
from index payload accounting. Broader epic qualification remains separate.
