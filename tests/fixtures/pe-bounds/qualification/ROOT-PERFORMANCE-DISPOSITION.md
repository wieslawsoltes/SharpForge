# Root automated performance disposition — PE header and section bounds

The root automated reviewer explicitly accepts all observed adverse measurements in this single cohort as
a correctness tradeoff for eager PE header and section-range admission. This includes the four
median/p95/p99 regressions above 5%, every other adverse median/tail value, and all adverse minima and
maxima listed below. This is a quantified automated-review performance exception under the repository
regression policy. It is not human approval, a threshold pass, a claim of statistical significance, or
evidence of a causal speedup. The original raw report remains unchanged with its historical
pending-review field; this document supplies the subsequent disposition authorized by the root reviewer
on 2026-10-04.

The reviewer independently inspected the 51-line shared bounds seam and reader changes: complete
header-range admission plus two sorted raw/virtual interval indexes, bounded by the existing maximum of
96 sections. Admission is O(n log n) time and O(n) auxiliary space. The query path gains no sort or
array; metadata is not parsed twice. No concrete avoidable work specific to the adverse paths was found.
The correctness benefit is immediate rejection of invalid headers and otherwise unreferenced overlapping
sections before metadata access. Shared-host load and signed heap observations are retained as context;
neither is used to dismiss costs or assert a noise/GC explanation.

| Role | Exact revision |
| --- | --- |
| Product admission | `6e3d26f3ec6abe54699fce1caefa57e9a5c569f5` |
| Native capture and focused gate | `17de856493ba42091413e2968ad526efb7a79758` |
| Measured candidate | `4890736f2da1bf2b8bd9c4e40f2f727b4d09f4d1` |
| Actual-main baseline | `75f0caad1c3ea096a656feb2989b867781edc82f` |

The measured candidate is an evidence-only descendant of the native-qualified product. Independent review
matched 364 baseline and 365 candidate package source files, 1,089 outer source records, ten harness tool
hashes, all 424 captured native-source hashes, job/result/log/input hashes, and native links. Both
checkouts use their own public package aliases. Original executed recorder and plan remain byte-exact:
SHA-256 d3d32dbd59cc74601d5148b79f71b8e9de84205918af2252f12a0675f805bc4e and
ad2a019e274bd63f5d0ba0ae6605bf6ebebf8a4c31eb0c44b02bd92ac6520909.

All values below are microseconds per operation derived from measured batch means. Each workload has 20
warmup and 100 measured batches per side. Median is the mean of the two central sorted measured values;
p95 and p99 use nearest rank. These are batch-mean distributions, not individual-call latency. Displayed
values are rounded; every original chronological value and full-precision recomputation is retained.

| Workload | Statistic | Baseline µs/op | Candidate µs/op | Change |
| --- | --- | ---: | ---: | ---: |
| Small three-section PE | median | 20.432012 | 17.379633 | -14.9392% |
| Small three-section PE | p95 | 130.232539 | 126.072867 | -3.1940% |
| Small three-section PE | p99 | 217.143844 | 245.333539 | +12.9820% |
| Dense 96-section PE | median | 100.599031 | 74.735734 | -25.7093% |
| Dense 96-section PE | p95 | 309.293719 | 193.349969 | -37.4866% |
| Dense 96-section PE | p99 | 571.180375 | 352.737563 | -38.2441% |
| Real managed IL | median | 88.614719 | 54.590742 | -38.3954% |
| Real managed IL | p95 | 251.169469 | 268.902469 | +7.0602% |
| Real managed IL | p99 | 450.983859 | 377.296313 | -16.3393% |
| Pinned ReadyToRun | median | 129.268980 | 134.652820 | +4.1648% |
| Pinned ReadyToRun | p95 | 645.589720 | 575.037800 | -10.9283% |
| Pinned ReadyToRun | p99 | 846.331560 | 720.265360 | -14.8956% |
| Pinned mixed mode | median | 83.241720 | 86.131740 | +3.4718% |
| Pinned mixed mode | p95 | 472.681640 | 548.192960 | +15.9751% |
| Pinned mixed mode | p99 | 580.925840 | 670.976160 | +15.5012% |

Every adverse statistic is explicitly accepted below, including values below 5%. The four central tail
exceptions are small p99 +12.9820%, real IL p95 +7.0602%, mixed p95 +15.9751%, and mixed p99 +15.5012%.
Additional adverse extrema above 5% are small minimum +5.2326%, dense96 minimum +8.6865%, dense96 maximum
+31.8065%, and mixed maximum +16.4637%. Favorable medians do not cancel these costs.

| Workload | Statistic | Baseline µs/op | Candidate µs/op | Added µs/op | Change |
| --- | --- | ---: | ---: | ---: | ---: |
| Small three-section PE | p99 | 217.143844 | 245.333539 | +28.189695 | +12.9820% |
| Small three-section PE | min | 12.111461 | 12.745211 | +0.633750 | +5.2326% |
| Small three-section PE | max | 248.178742 | 252.065844 | +3.887102 | +1.5663% |
| Dense 96-section PE | min | 49.589719 | 53.897312 | +4.307594 | +8.6865% |
| Dense 96-section PE | max | 762.395969 | 1004.887188 | +242.491219 | +31.8065% |
| Real managed IL | p95 | 251.169469 | 268.902469 | +17.733000 | +7.0602% |
| Pinned ReadyToRun | median | 129.268980 | 134.652820 | +5.383840 | +4.1648% |
| Pinned ReadyToRun | min | 115.484160 | 116.329680 | +0.845520 | +0.7322% |
| Pinned mixed mode | median | 83.241720 | 86.131740 | +2.890020 | +3.4718% |
| Pinned mixed mode | p95 | 472.681640 | 548.192960 | +75.511320 | +15.9751% |
| Pinned mixed mode | p99 | 580.925840 | 670.976160 | +90.050320 | +15.5012% |
| Pinned mixed mode | max | 621.621680 | 723.963600 | +102.341920 | +16.4637% |

The fixed serial cohort has 12 fresh children: two preparation children and ten measurement children. It
retains 1,200 chronological rows, comprising 200 warmup and 1,000 measured batches. There are exactly
54,800 measured calls and 10,960 warmup calls, 65,760 timed calls with passing guards in total, plus 60
untimed worker preflight reads. Per-batch calls are 128 small, 32 dense96, 64 real IL, 25 R2R and 25
mixed. Pair order alternates by workload. No samples were removed and the cohort was not repeated.

The timed operation is public readPE plus storing returned references. Imports, process startup, fixture
construction, options/output-array preparation, native replay, guards, statistics and I/O are outside
timing. Complete public reader data facts, borrowed input identity, module name and section offset
queries are checked outside timing. Method-body callback execution is not timed or independently covered
by this benchmark. Small, dense96 and real IL use default options; R2R and mixed use the existing
inspection mode.

The host was Linux x64, kernel 6.18.44, Node v24.19.0, AMD EPYC 9V74 80-Core Processor with nine logical
CPUs visible to the container, and NODE_OPTIONS=--max-old-space-size=2048. This was a shared host with
the team measurement window reserved. Load averages were [1.75, 1.45, 1.95] before and [2.35, 1.64, 2]
after; free-memory observations were 5,012,566,016 and 5,128,196,096 bytes. No forced GC was used. The
driver ran from 19:21:34.311Z to 19:22:01.984Z on 2026-10-04. All twelve child stderr logs are empty. The
outer stderr retains a 94-byte resource-slot waiting notification emitted before benchmark startup; it is
excluded from timed measurements.

The following signed net heapUsed differences describe each measured batch, including returned references
and runtime memory activity. Negative-sample counts cover exactly 100 measured batches per side. These
values are not allocation counts, peak RSS, retained-size proofs or evidence of GC causation.

| Workload / side | Median net bytes | Minimum net bytes | Maximum net bytes | Negative batches / 100 |
| --- | ---: | ---: | ---: | ---: |
| small / baseline | 3,495,884 | -55,006,432 | 3,539,208 | 5 |
| small / candidate | 3,815,776 | -55,165,256 | 3,868,384 | 7 |
| dense96 / baseline | 3,924,472 | -58,599,944 | 3,959,160 | 7 |
| dense96 / candidate | 4,524,704 | -131,348,568 | 4,534,768 | 9 |
| il / baseline | 7,250,552 | -151,305,792 | 7,322,216 | 13 |
| il / candidate | 7,410,624 | -96,706,560 | 7,482,464 | 14 |
| r2r / baseline | 7,560,496 | -160,876,784 | 7,621,680 | 14 |
| r2r / candidate | 7,624,508 | -35,591,208 | 7,690,776 | 14 |
| mixed / baseline | 4,717,024 | -124,011,640 | 4,760,272 | 9 |
| mixed / candidate | 4,792,504 | -106,907,848 | 4,841,792 | 11 |

Native qualification observed 58 authored PE32/PE32+ cases: 20 both accepted with matching header facts,
eight both rejected, and 30 rejected by SharpForge while native PEReader admitted the headers. The 30
differences retain the intentionally stricter eager-overlap/zero-raw policy; they are not converted into
a parity claim. Three real references—managed CFG IL, pinned ReadyToRun and pinned mixed mode—have no
differences in the existing complete native fact comparison. Inputs were inspected, not loaded or
executed. No Windows mixed-mode execution on Linux is claimed.

The exact seven-file focused gate passed 91/91 tests with zero failures, skips or cancellations. Native
capture, external verification, exclusive retention, retained verification, focused tests and performance
all have successful actual phase receipts with empty interruption lists. Native raw provenance covers six
build/observer workload commands; legacy toolchain version probes retain identities only. The SDK/runtime
pins are 10.0.201/10.0.5. The original 13 native evidence files, prior 13 execution files and their
retention manifest remain unchanged.
The earlier native/gate retention manifest retains its historical pending-performance field because
it predates the cohort; the additional evidence and this disposition record the subsequent result.

The independent review addendum records a narrow final-write interruption window in the executed outer
recorder. No interrupted execution is inferred from the six actual successful receipts. Additive
run-step-v3.py and validation-plan-v3.json correct future handled-interruption finalization and have
independent source review; they remain unexecuted, including cancellation regression tests. The executed
recorder/plan and all 424 captured source identities were preserved. Future explicit native verification
uses its separate reference directory; the unchanged focused gate and benchmark retain the original
qualified reference corpus. See ../QUALIFICATION-V3.md for the completion boundary.

Retention is complete: performance-cancellation-first/ contains all 52 raw files and exactly 4,225,351
bytes; performance-retention.json binds every original/retained byte count and SHA-256. Three actual
outer performance files were added to execution-cancellation-first/. No supplied R2R or mixed-mode binary
was copied; the three retained image files are the authored small/dense fixtures and the existing managed
CFG fixture. The independent JSON review, its recomputation source retained as .py.txt, and its addendum
are copied unchanged. The review hashes are respectively
c01850bc2c11be88fb3dfee887a60a95836ce3095a20c74a7c9b3c7042b88d70,
e2ffd6b624a4a24738e32e95690e94a9fa27d041b84092d62d73959cea29785b, and
87acc50f897cc42433ec89b4b866cce05f907a21e6c55a3b0f53e572c608187f.

The actual benchmark command, also retained with environment and status in the outer receipt, was:

```sh
node scripts/limited.js node packages/cil/tools/benchmark-pe-bounds.mjs \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-pe-bounds-baseline-75f0caad \
  --r2r /workspace/scratch/7e3d2a445c44/dotnet-10.0.201/shared/Microsoft.NETCore.App/10.0.5/System.ComponentModel.Primitives.dll \
  --mixed /workspace/scratch/7e3d2a445c44/pe-MixedNativeCLI.exe \
  --output /workspace/scratch/7e3d2a445c44/project6-pe-bounds-performance.cancellation-first
```

This disposition qualifies the recorded Linux Node/native-reader observations and accepts their measured
performance cost for this batch. Issue #2417 remains open for broader OS/browser/engine acceptance. No
browser, source VM, direct CIL, Rust native/Wasm, signing verification or operating-system image-loader
execution result is claimed. Core/build/publication remain separate coordinator gates.

