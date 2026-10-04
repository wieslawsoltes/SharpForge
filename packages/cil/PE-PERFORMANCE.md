# SF-A13-T16 performance protocol

**First cohort retained; all three ordinary medians exceed the 5% budget.**
The once-only run at `40561f093648ea6cc5f840c0a19b3d8fb512b34b` passed every
output guard and retained all 960 chronological samples. That status does not
accept its performance regressions. The [complete independent review and original
artifacts](../../tests/fixtures/pe-inspection/qualification/performance-first/independent-review.md)
retain the receipt, log, hashes, exact raw samples, unfavorable tails, source
analysis, and recommendation for three narrow construction changes followed by
one new unchanged cohort.

| Ordinary workload | Median change | p95 change |
| --- | ---: | ---: |
| `readPE` | +13.62749% | +26.46312% |
| `coldSummary` | +21.92840% | +21.39369% |
| `warmMetadataSummary` | +27.11903% | +19.47191% |

These statistics describe batch means normalized per call. Native inspection
and the 130-test Node gate apply to the original source recorded in the
[fixture evidence](../../tests/fixtures/pe-inspection/README.md). The first
benchmark used frozen product revision `26d4808350116a2ae95c5216393bd690032c6034`,
whose runtime source is the tested integration
`bf0d9470e4dc50cfdcafb0a6532cea0892b753d6`. Its baseline is the exact pre-PE
main revision `d64188af91f03d02041316bdde2ee64fd0634be0`. Evidence retention
does not change product source or qualify an optimized candidate.

## Construction candidate

Product revision `d72a9fe1684ba28064f83f4307721a1d00b13137` contains only the
three reviewed construction changes: build each directory record once, append
the optional summary PE field conditionally, and populate implementation facts
into fresh method destinations. Field order, fresh nested disassembly records,
classification, cancellation, and bounds remain intact. No performance effect
has been measured for this candidate.

One fresh two-image native capture passed with the unchanged pinned observer,
tools, images, and comparison helper. The [complete comparison of original and
fresh captures](../../tests/fixtures/pe-inspection/qualification/optimized/native-comparison.json)
records identical native facts and parity results. The fresh capture differs
only in the three approved source hashes and two observer timing observations.
The original `native.json` and qualification receipts remain byte-exact in the
first cohort's archive.

The unchanged ten-file Node gate passed once: 130/130 tests, zero failures,
cancellations, and skips, at `135c4c0b151acc92b28b724b410e9db54066b29e`.
The [full output and review](../../tests/fixtures/pe-inspection/qualification/optimized/focused-review.json)
also retain a post-run receipt parser error: it expected TAP summary lines while
the unchanged command used Node's default reporter. The original receipt/output
were preserved; reading the existing summary confirmed the pass without a rerun.

The second benchmark cohort remains pending. Its source/fixture pin is
`135c4c0b151acc92b28b724b410e9db54066b29e`, whose product source is exactly
`d72a9fe1684ba28064f83f4307721a1d00b13137`. Its native fixture hash is
`8cf9f13a29b3d74f4d6d395a521f130de5abf6d7482d16a8763109a3d0cd80f1`.
The offline test and benchmark retain strict current source-hash checks. Only
the driver source/native pins and exact allowlist source hash changed. All
workload definitions, counts, order, guards, baseline, and inputs are unchanged.

## Source review before measurement

The ordinary `readPE` path now decodes every optional-header scalar, including
four additional stack/heap UInt64 values represented by `BigInt`. It retains an
optional-header record, extra COFF/section scalars, the CLI header size, and
advertised directories after the standard sixteen. These costs apply during
ordinary loading even when the caller never requests a PE snapshot. Existing
metadata parsing, RVA lookup, and section/directory limits remain the underlying
reader. A direct `readPE` control is necessary to expose this mandatory work.

Nonzero MethodDefs now pass the shared implementation-kind admission guard.
Cold public method records include `codeKind` and a `disassembly` record, and
metadata-only summaries construct these facts on each request. Ordinary summary
headers add `imageKind`; summary traversal also checks cancellation. Cached public
`getMethod` still returns through the same single `Map.get` path, with its object
identity preserved. The ordinary controls cover fresh/full and warm/metadata-only
summary work; cached lookup identity and complete listing output are correctness
guards outside timing.

`inspectPE` is a separate, opt-in API. Its cost includes PE/metadata parsing,
owned header/section/directory projection, and bounded debug/strong-name payload
copying and hexadecimal output. It does not decode native instructions or map
ReadyToRun native bodies to methods. The shared raw debug reader now owns its
payloads before the symbols package interprets them; this protocol does not make
a PDB-consumer performance claim.

The existing `tests/benchmarks/cil-pe.mjs` measures raw read/write with a different
fixture and does not retain chronological samples or complete inspector-result
guards. The CFG benchmark targets a different operation. The new developer-only
driver reuses `tests/managed-fixtures.js#arithmeticLibrary`, the public package
entries, the existing PE native-comparison helper, and the shared performance
statistics/provenance helpers. It adds no parser or runtime dependency.

## One predetermined cohort

| Workload | Variants | Calls per batch | Included in timing |
| --- | --- | ---: | --- |
| `readPE` | Exact baseline and candidate | 200 | Ordinary PE/metadata parsing |
| `coldSummary` | Exact baseline and candidate | 100 | New inspector and complete default summary |
| `warmMetadataSummary` | Exact baseline and candidate | 500 | Metadata-only summary on a prewarmed, separate inspector |
| `inspectPE-r2r` | Candidate | 25 | New API on the pinned real ReadyToRun image |
| `inspectPE-mixed` | Candidate | 25 | New API on the pinned real mixed-mode image |

Each workload/variant receives **20 warmup batches and 100 measured batches**.
The driver retains both phases in chronological order, alternates paired variant
order each round, and rotates workload order. Statistics use the true even-sample
median and nearest-rank p95/p99 from the shared `distribution` helper. Existing
API changes and new API costs are separate report groups. Only the ordinary group
has a baseline comparison and a greater-than-5% regression indicator.

All ordinary calls receive the same unchanged PE32 arithmetic bytes. Before
timing, the baseline supplies complete expected facts for the reader, all headers,
sections, directories, CLI and metadata data, section RVA results, every CIL body,
full/metadata-only/paged summaries, every public method, the disassembler result,
and the exact formatted IL listing. Every existing field must match in the
candidate; additional fields are retained explicitly in the report. Undefined
values and UInt64 precision are preserved in the fact representation. Byte
sequences are compared by their length and SHA-256.

Every timed return value is retained and checked outside its timed region against
the corresponding complete preflight facts. Full reader/inspector/listing facts
are checked again after measurement. The three fixture methods and their eleven
instructions are asserted before timing. No checksum based on an absent field
can qualify the run.

Both real images must match `reference-images.json` and the byte-exact retained
`native.json` capture. The existing `compareReference` checks all eight independent
PEReader/SRM groups before and after timing, including available CIL and Native
method boundaries. Every `inspectPE` return is checked by its complete snapshot
SHA-256 outside timing. Retained output contains scalar dimensions and hashes;
it contains no upstream image, IL, debug, or signing payload. Neither input is
executed, and no baseline-equivalent inspection of either image is claimed.

## Original capture command

Use separate clean worktrees with public `@sharpforge/*` aliases pointing into
their own checkout. The driver checks the exact baseline HEAD, candidate source
identity, transitive aliases, tool hashes, and native/source fixture freshness
before timing and again afterward. Its two dynamic imports are restricted by an
exact source-hash/count entry: the verified baseline public CIL entry and the
fixed adjacent benchmark module. Image bytes never select executable modules.

The first cohort used this command in the assigned heavy-work slot. It is
retained as historical provenance; its existing output must not be overwritten.
The output directory was outside both clean trees and the output file was new:

```sh
node scripts/limited.js node packages/cil/tools/benchmark-pe-inspection.mjs \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-pe-baseline-d64188af \
  --r2r /workspace/scratch/7e3d2a445c44/dotnet-10.0.201/shared/Microsoft.NETCore.App/10.0.5/System.ComponentModel.Primitives.dll \
  --mixed /workspace/scratch/7e3d2a445c44/pe-MixedNativeCLI.exe \
  --output /workspace/scratch/7e3d2a445c44/project6-pe-performance-first.json
```

The one scheduled construction-candidate cohort uses the same command with a
new output file, after the frozen driver and native fixture pins above:

```sh
node scripts/limited.js node packages/cil/tools/benchmark-pe-inspection.mjs \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-pe-baseline-d64188af \
  --r2r /workspace/scratch/7e3d2a445c44/dotnet-10.0.201/shared/Microsoft.NETCore.App/10.0.5/System.ComponentModel.Primitives.dll \
  --mixed /workspace/scratch/7e3d2a445c44/pe-MixedNativeCLI.exe \
  --output /workspace/scratch/7e3d2a445c44/project6-pe-performance-optimized.json
```

The benchmark runs in one Node process with both package graphs loaded. Imports,
fixture creation, native comparison, output guards, and final statistics are
outside timing. Timed work includes storing results in a preallocated array;
result retention and guard allocations can affect later GC. The report records
the Node executable hash, source/tool/fixture hashes, Git identities, relevant
wrapper environment, machine information, start/end load and memory, and signed
per-batch `heapUsed` observations. No forced GC or allocation counter is used.
Heap deltas can be negative and are neither allocation counts nor peak heap.
The host is shared; the three-method fixture is not a large-assembly or universal
loader performance qualification.

Caught failures retain partial chronological samples and a failed status. A
successful status confirms output guards and sample completeness; it does not
waive a measured regression. Preserve the first report and log, including slow
cohorts, and retain explicit quantified PR sign-off if an existing operation
regresses beyond the repository budget. The original protocol preparation ran no
benchmark, build, or browser replay. The subsequent first cohort is retained
above; the independent review and retention commit ran no additional cohort.
