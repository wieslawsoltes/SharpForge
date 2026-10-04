# Canonical nominal categories

`input.js` constructs real CLI metadata rows for synthetic authority contract
tests. Deliberately non-platform names demonstrate that spelling supplies no
category authority. These malformed/boundary graphs are not native-loadability
claims.

`Program.cs` independently reports CoreCLR categories for Object, ValueType,
Enum, String, Int32, DayOfWeek and IDisposable, plus ordinary local classes,
nested classes, an interface, a struct and an enum. It reports actual metadata
root tokens and input TypeRef bindings into `typeof(object).Module`.
`capture.mjs` uses the repository-pinned Roslyn/CoreCLR toolchain, reads that
actual CoreLib PE and first constructs its complete `AssemblyInspector`.

The retained capture records source/compiler/reference hashes, input assembly,
native output, the actual core PE SHA256/size/MVID and a compressed exact metadata
projection. This projection retains original rows/tokens for tables 0, 1, 2, 9,
26, 27, 35, 41 and 42, plus #Strings. It contains all facts consumed by the type
adapter; it is not a generated replacement core library. Both the full inspector
and the owned projection must agree with native results before capture succeeds.
Offline tests replay the same projection without requiring an installed runtime.

At product `f2a3dda01`, 97/97 focused/affected tests passed. The original 96/97
attempt is retained: an existing malformed TypeDef flags test expected member
diagnostic CILVM0001; the new canonical flag guard correctly rejects it earlier
with CILVT0001. Only that diagnostic expectation changed; product source did not.
The native SDK 10.0.201 / CoreCLR 10.0.5 capture passed seven core and seven local
comparisons. Full CoreLib was 17,083,192 bytes, SHA256
`2f516ce22a74b943436d016af0483801fd407dd42b49b86fdd12fe290ac6258c`.
Generate the capture:

```sh
node scripts/limited.js node tests/fixtures/a03-type-categories/capture.mjs /tmp/type-categories-native.json
```

The public source-module contract passed 20 checks each on Chromium 153.0.8010.12,
Firefox 155.0 and WebKit 26.6 with CSP enabled. Syntax checked 3,626 modules and
imports 3,622, both with zero errors; manifests had zero unassigned/duplicate
tests. Structure reported 272 existing findings, none in this batch.

The isolated baseline was `b79fbbb9e`; candidate qualification heads were
`cdf349c98` then test-only correction `41982b9ef`. Both worktrees installed their
own dependencies and resolved their own CIL package. Source/input/manifests,
projection and browser hashes, both drivers, original failure, commands and all
96 chronological samples are in `qualification/`. No successful native or
baseline stage was repeated. A compiler test run occupied the machine limiter
between attempts; the resume waited for it before executing.

Apple M3 Pro / macOS 26.6 / Node 24.21.0 timings below are milliseconds per 1,000
operations, with 12 samples per mode and the first three fixed warmups:

| Existing operation | Median before → after | p95 before → after |
| --- | --- | --- |
| Construction | 3.919375 → 4.309500 (+9.95%) | 4.798167 → 5.245792 (+9.33%) |
| Inherited-interface query | 0.347583 → 0.345542 (-0.59%) | 0.383167 → 0.647375 (+68.95%) |
| Local-alias construction/resolution | 11.758458 → 14.871792 (+26.48%) | 13.110500 → 16.619666 (+26.77%) |

The new authority construction/category workload has full median/p95 cost
5.615583 / 7.466041 ms per 1,000 contexts; its unknown-to-known change is added
capability, not an existing-operation comparison. No noise, causal, speedup,
allocation-volume or peak-memory conclusion is drawn. Root review requested
removing default-path category scans and unused category fields before accepting
these increases. The first 96 samples remain retained; the resulting source
change is qualified separately rather than repeating an unchanged measurement.

This batch supplies category authority only. Full #2403 object transfers and
#2405 construction/initialization state remain open. No execution backend is
enabled by this metadata API.
