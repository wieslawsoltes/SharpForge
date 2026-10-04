# Inspector navigation and method pages

Qualified #2575 source `75ebc1606454b0f44230a31f9d2ce5138a944893`, harness
`8ee7dfc696f5787a8b477d0a05ac0a9aa8b9b150`, against main base
`e905566c1933830deb6de7249062113c2b0eeee5`. The final evidence commit changes no
runtime source, tests or harnesses.

## Scope and results

Eight new tests cover a 20,000-method image with exact cache/decode counts,
owned page results, definition-only/empty/end pages, invalid limits, aggregate
declared-code budget before decoding, cancellation, default summary compatibility,
MethodPtr order, every declared metadata row/user-string URI, raw token coercion,
wrong module identity and the retained Roslyn UnnamedSlots PE. The old baseline
fails the page-count regression with `4 !== 2`; the new focused suite passes
**82/82**, including managed inspection/CLI/decompiler, MethodPtr, managed-resource
summary and IL-document consumers. No test was skipped.

The one shared browser round passed five groups in each of Chromium 153.0.8010.12,
Firefox 155.0 and WebKit 26.6 on macOS 26.6 arm64, using Python 3.14.7 and
Playwright 1.63.0. It serves source modules through an import map with CSP enabled;
every browser and server is closed. The module hash, exact engine results and
native provenance are in [browser.json](qualification/browser.json).

The retained Release/optimized UnnamedSlots PE was built by SDK 10.0.201,
Roslyn 5.3.0-2.26153.122 (`4d3023de605a78ba3e59e50c657eed70f125c68a`), and observed
on CoreCLR 10.0.5. Node/browser tests reuse its method descriptors and verify its
SHA-256; no native rebuild was needed. An authored fixture pins GUID byte order.
This batch inspects assemblies; it does not execute them or load external assemblies.

Static/manifests passed: 3,485 syntax and 3,481 static modules, zero errors;
924 Node files, 37 browser scripts, 30 areas, no missing/duplicate assignments.
Structure returned zero with 271 existing reports and no findings in this batch's
inspector/browser paths. Full stage logs, including the expected old failure, are
retained in [validation.txt](qualification/validation.txt).

## Existing summary control

One fixed interleaved 20-pair AB/BA schedule per control retains all 80 chronological
samples, without repeats or exclusions, in [performance.json](qualification/performance.json).
The machine was a shared Apple M3 Pro/macOS arm64 host with Node 24.21.0. Exact source
revisions and byte-identical shared dependency proofs are in
[configuration.json](qualification/configuration.json). Each variant resolves its
own CIL source; only unchanged transitive package trees/manifests were shared.

| Control, milliseconds per call | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Construct inspector + legacy summary | 0.715488545 | 0.690965000 | 0.750498750 | 0.717044170 |
| Cached legacy summary | 0.022226583 | 0.019921459 | 0.023813584 | 0.020834666 |

Both complete legacy summaries are deeply equal, including order and nested values.
No measured control exceeds the regression budget. These shared-host observations
make no speedup, significance, causal noise or peak-allocation claim.

`comparison.mjs.txt` is the exact runnable benchmark source (copy to `.mjs` before
running); its hash and protocol are retained in the result. It uses the retained
LocalConstants PE, 30 cold/100 cached warmups, 100 cold/500 cached calls per sample,
GC before each sample, mean middle-pair median and nearest-rank p95. The scheduled
serial driver ran the following stages, awaiting each terminal result:

```text
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=1024 node scripts/limited.js node \
/tmp/sharpforge-a13-navigation-driver.mjs \
install baselineProof focused benchmark browser check structure
```

`browser.py <repository> <output>` runs the sibling module serially in the three
engines. `fixture.mjs` is the same authored builder used by Node and browser tests.
The focused files were `a13-11-inspector-navigation`, `managed-il`,
`a03-01-pointer-tables`, `a03-03-managed-resources` and `a03-05-il-document-layout`.

## Limits

The inspector still parses and indexes metadata names/ownership at construction;
pagination defers selected method projection and omits full inventories. Its code-byte
cap measures logical declared code sizes, not total heap/EH memory. MVID-scoped URIs
identify metadata within a module; they do not establish content or signature identity.
This is focused Node/macOS/browser evidence, not a Studio/full-matrix, Windows/Linux,
Rust/Wasm execution or cross-platform parity claim.
