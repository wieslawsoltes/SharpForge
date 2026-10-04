# SF-A13-T16 performance protocol

**Prepared; not executed.** This protocol adds no product changes and makes no
performance pass or regression claim. Native inspection and the 130-test Node
gate remain qualified at the source recorded in the
[fixture evidence](../../tests/fixtures/pe-inspection/README.md). The benchmark
uses frozen product revision `26d4808350116a2ae95c5216393bd690032c6034`, whose
runtime source is the tested integration `bf0d9470e4dc50cfdcafb0a6532cea0892b753d6`.
Its baseline is the exact pre-PE main revision
`d64188af91f03d02041316bdde2ee64fd0634be0`.

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

## Capture command

Use separate clean worktrees with public `@sharpforge/*` aliases pointing into
their own checkout. The driver checks the exact baseline HEAD, candidate source
identity, transitive aliases, tool hashes, and native/source fixture freshness
before timing and again afterward. Its two dynamic imports are restricted by an
exact source-hash/count entry: the verified baseline public CIL entry and the
fixed adjacent benchmark module. Image bytes never select executable modules.

Run once in the candidate tree during the assigned heavy-work slot. The output
directory must already exist outside both trees, and the output file must be new:

```sh
node scripts/limited.js node packages/cil/tools/benchmark-pe-inspection.mjs \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-pe-baseline-d64188af \
  --r2r /workspace/scratch/7e3d2a445c44/dotnet-10.0.201/shared/Microsoft.NETCore.App/10.0.5/System.ComponentModel.Primitives.dll \
  --mixed /workspace/scratch/7e3d2a445c44/pe-MixedNativeCLI.exe \
  --output /workspace/scratch/7e3d2a445c44/project6-pe-performance-first.json
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
regresses beyond the repository budget. No benchmark, build, or browser replay
was run while preparing this protocol.
