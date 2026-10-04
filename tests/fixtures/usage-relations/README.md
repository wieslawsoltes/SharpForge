# Bounded instruction usage relations

Qualified first #2573 batch: `uses`, `used-by`, `instantiated-by` and `assigned-by`
occurrence indexes. The full leaf remains open: `overridden-by` and `implemented-by`
require genuine canonical method-slot contracts. The CIL package does not import CLR.

`input.mjs` independently authors CLI metadata with direct/MemberRef method and field
aliases, constructor use, repeated calls, field stores, type handles, an array and an
unresolved external call. Eight focused groups cover exact sets, ordering/pagination,
owned output, aggregate limits, raw-token rejection, malformed IL, cancellation,
non-CIL incompleteness and legacy callGraph/cache/error compatibility.

`native.json` captures three methods from actual Roslyn/CoreCLR output. Reflection's
`GetMethodBody`, `System.Reflection.Emit.OpCodes` and `Module.ResolveMember` independently
report operand sites and local canonical identities. SDK 10.0.201, runtime/reference
pack 10.0.5 and Roslyn 5.3.0-2.26153.122 are pinned with compiler/reference/source/image
hashes and raw process output. Image SHA-256:
`f2ac1a8f66964996d91881396911b1c3e7054ac3b37c4f068eb171b5387374e8`.
Offline tests never compile or modify tracked files.

Existing CIL decoder/member/type resolver seams provide canonical local identities;
unsupported constructed/generic/external bindings stay explicitly unknown. Literals
are not symbol dependencies; array allocation is not element-type construction;
indirect writes are not inferred from address-taking. Query `complete` describes body
scan coverage, not completeness of external binding or runtime dispatch.

## Qualification

One serial limiter-owned pipeline on 2026-10-04, Node 24.21.0, concurrency/max-runs 1,
1 GiB Node heap, qualified exact source `f4c6f7aecec1a71624224faa8577a0288ee6d7e2`:

- Native capture succeeded once; no failed native/product attempt or retry.
- 37/37 focused tests: eight new groups plus 29 existing framework/object/string cases.
- Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 on macOS 26.6 arm64 passed
  three focused browser groups each, including actual native reference replay.
  The HTTP source-module runner uses CSP and terminates every browser/server.
- `npm run check`: 3678 syntax modules and 3674 static modules, zero errors;
  1002 Node test files / 37 browser scripts / 30 areas, no manifest collision.
- `npm run check:structure`: no owned findings; 272 inherited reports retained.

All raw logs, per-engine records, exact revisions, dependency hashes and chronological
measurements are in [qualification](./qualification). Browser coverage is those three
engines on this host, not Windows/Linux or a full execution-engine matrix.

## Fixed performance observations

`comparison.mjs.txt` ran once with 20 alternating before/after pairs, three warmup
cells per available variant/case, and fixed iterations. All 120 chronological samples
are retained. The baseline is `e984a0f5d9aeaf0b4dcb9d6102a83bc9edb627a6`; each variant
uses its own CIL source, sharing only hash-proven identical other packages/dependencies.
The exact command arguments and host/fixture hash are in the configuration/report.

| Operation | Before median / p95 ms | After median / p95 ms |
| --- | --- | --- |
| Cold inspector + legacy callGraph | 0.069692710 / 0.080615000 | 0.070803545 / 0.096830000 |
| Warm cached legacy callGraph | 0.000272291 / 0.000688583 | 0.0002722085 / 0.000626833 |
| New analysis construction | n/a | 0.044957505 / 0.054767500 |
| New indexed one-result query | n/a | 0.000338041 / 0.000370584 |

Root reviewer explicitly accepted the cold control median +0.001110835 ms (+1.594%)
and p95 +0.016215 ms (+20.114%) after reviewing the narrow callGraph extraction:
legacy output/cache/error behavior is preserved, no new graph is eagerly built, and
the owning seam remains maintainable. This is the measured tradeoff, not a causal,
noise, significance or speedup claim. No samples were excluded or repeated.
Logical byte/occurrence/index counters are not process heap or peak-allocation bounds.
