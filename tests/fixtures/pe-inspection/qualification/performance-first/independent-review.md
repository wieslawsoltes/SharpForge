# Independent review of the first PE inspection cohort

## Decision and scope

One additional fixed cohort is justified after three small construction changes.
The source contains temporary records that can be removed while preserving every
public field, fresh result ownership, validation, and bounds. Make those changes
before deciding whether to accept the measured regression. This recommendation
does not predict a speedup, attribute the regression to those records, or approve
all remaining cost as necessary.

This review examined the original frozen source, baseline, complete raw report,
execution receipt, log, timing protocol, statistics, and output guards. It ran no
tests, benchmarks, native captures, or browser replays and changed no product
source. The first report remains an unfavorable but valid cohort. Its `pass`
status records successful guards and complete samples; all three ordinary median
changes exceed the repository's 5% budget and require explicit disposition.

The retained evidence is complete:

- [benchmark.json](benchmark.json): all 960 chronological rows, both warmup and
  measurement, full identities, guards, heap observations, and statistics.
- [benchmark.log](benchmark.log): original complete command output.
- [execution.json](execution.json): original wrapper command, timing, exit code,
  and report/log hashes.
- [provenance.json](provenance.json): byte counts and hashes of those originals,
  copied source/tool identities, and independently recomputed sample statistics.
- [original-native.json](original-native.json): the byte-exact original native
  observations and comparison results, accompanied by the original
  [native command](original-native-command.json), [native log](original-native-capture.log),
  [focused command](original-focused-command.json), [Node output](original-focused-node.tap),
  and [qualification summary](original-qualification-summary.json).

## Provenance and protocol checks

The candidate was clean at
`40561f093648ea6cc5f840c0a19b3d8fb512b34b`, with tree
`29bcb3ede4b9b7bdb5f517038307ac27b44a3a7d`. Its frozen product revision was
`26d4808350116a2ae95c5216393bd690032c6034`; that product source matched the
native and focused Node integration at
`bf0d9470e4dc50cfdcafb0a6532cea0892b753d6`. The exact baseline was
`d64188af91f03d02041316bdde2ee64fd0634be0`, tree
`d683a1cee6e29cddb2735734878f70c1ea382a05`.

The report began at `2026-10-04T14:49:19.020Z` and ended at
`2026-10-04T14:49:34.903Z`. The enclosing receipt records
`14:49:18.888615+00:00` through `14:49:34.954322+00:00`, exit code 0.
The exact command remains in both the report and receipt. Their original paths
remain in those files even though copies are now retained here.

The report SHA-256 is
`3bd921de526e52d1b343b4f820c2993e97d917c4964765dd49cb7d87682688db`.
The log SHA-256 is
`df00418b4688be826cc31b9b1ee29f0315536cbba118800ce9fa18d7e9d62a49`.
Both match the receipt. The receipt SHA-256 is
`66c1088a16e07abb2d72953efbd9d84c32385d18ebd62ef058118c917e65150a`.
All recorded source/tool identities matched the frozen original source reviewed.

The host used Node `v24.19.0`, Linux x64, an AMD EPYC 9V74 CPU, and nine
reported logical CPUs. It was a shared host. The executable SHA-256 was
`bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`;
`NODE_OPTIONS` was `--max-old-space-size=2048`. The run used no forced GC and
no allocation counter. Environment, load, and memory observations are preserved
in the raw report.

The five workloads produce eight workload/variant combinations. Each has exactly
20 warmup batches and 100 measured batches: 160 warmup rows and 800 measured
rows, 960 in total. Every row has its expected call count and a passing guard.
Chronological sequence numbers, rotating workload order, alternating paired
variant order, and phase/round numbering match the predetermined protocol.
Recomputed even-sample medians and nearest-rank p95/p99 match every recorded
statistic exactly. No samples were removed or replaced.

Calls per batch are 200 for `readPE`, 100 for `coldSummary`, 500 for
`warmMetadataSummary`, and 25 for each real-image `inspectPE` workload. Timing
includes the API call and storing its returned reference into a preallocated
array. Every result remains alive until the batch's complete checks finish
outside timing; the result array is then filled with null. Imports, fixture
creation, fact projections/hashes, reference comparisons, and statistics are
outside timing. Retention and guard allocations can affect later heap/GC
behavior for either variant.

The driver verifies each checkout's transitive public package aliases. CIL,
bytecode, framework, BCL core, and BCL collections resolve within the matching
worktree, and the dependency sources outside CIL are unchanged between variants.
The ordinary input is the unchanged 1,536-byte PE32 arithmetic fixture with
three methods (`Add`, `Square`, `Hello`) and eleven instructions, SHA-256
`8d17b75da73afa2031fb40903cbdbe88e7d9cf42df65c6aab5a8f3d7c8506c15`.
This is a focused common-path control, not a large-assembly workload.

## Measured results

All times below are **microseconds per call, normalized from a whole batch**.
The median and percentiles describe the distribution of **batch means**, not
individual-call latency. The raw report retains nanoseconds per call without
rounding. Values here are rounded for reading.

| Ordinary workload | Baseline median | Candidate median | Median change | Baseline p95 | Candidate p95 | p95 change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `readPE` | 17.62579 | 20.02774 | +13.62749% | 36.88001 | 46.63961 | +26.46312% |
| `coldSummary` | 42.15007 | 51.39290 | +21.92840% | 100.12107 | 121.54066 | +21.39369% |
| `warmMetadataSummary` | 1.019568 | 1.296065 | +27.11903% | 1.754640 | 2.096302 | +19.47191% |

The corresponding median absolute increases are 2.4019525, 9.2428350, and
0.2764970 microseconds per call. The p95 absolute increases are 9.7596000,
21.4195900, and 0.3416620 microseconds per call.

| Ordinary workload | Baseline p99 | Candidate p99 | p99 change | Baseline maximum | Candidate maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| `readPE` | 52.89941 | 50.75786 | -4.04834% | 65.173605 | 53.372805 |
| `coldSummary` | 192.65389 | 180.41440 | -6.35310% | 206.35734 | 1,291.43583 |
| `warmMetadataSummary` | 1.941214 | 2.656706 | +36.85797% | 1.948544 | 7.719166 |

The candidate is slower in 74/100 paired `readPE` rounds, 78/100 paired cold
summary rounds, and 92/100 paired warm metadata summary rounds. These counts
describe this cohort; they are not a statistical significance claim. The lower
read/cold p99 values do not cancel the median and p95 regressions.

The largest candidate cold-summary batch is sequence 769, measured round 76:
129.143583 milliseconds for 100 calls. Its heap observation falls from
114,171,640 to 64,865,032 bytes, a delta of -49,306,608. The baseline cold
maximum is sequence 162, measured round 0: 20.635734 milliseconds, with heap
falling from 266,515,312 to 215,954,688 bytes, a delta of -50,560,624.
Those signed deltas do not establish a causal explanation for the long batches.
No scheduling, JIT, or GC diagnosis was measured, and no tail sample is dismissed
as noise. Heap deltas are neither allocation counts nor peak memory.

| New API workload | Candidate median | Candidate p95 | Candidate p99 | Candidate maximum |
| --- | ---: | ---: | ---: | ---: |
| `inspectPE-r2r` | 176.43616 | 376.35708 | 613.40696 | 813.24436 |
| `inspectPE-mixed` | 126.85310 | 280.22108 | 324.15456 | 581.46400 |

The new API has no equivalent baseline operation. These are cost observations
for two pinned inputs, not ordinary-API regressions or evidence for every PE.

## Guard assessment and reference scope

The ordinary guards compare all baseline public data: PE/header/section/directory
fields, CLI data, metadata rows and streams, section RVA results, every readable
CIL body, complete full/metadata-only/paged summaries, public method records,
the disassembler, and exact formatted IL listing. Additional candidate fields
are recorded explicitly. The fact representation retains undefined values and
UInt64 precision; byte sequences carry their size and SHA-256. The method and
instruction counts are checked before timing. Public method cache identity is
also checked. There is no acceptance based on a checksum of an absent field.

Every timed result is checked outside timing against complete preflight facts.
Full reader/inspector/listing facts are rechecked afterward. The two actual-image
workloads use the existing `compareReference` helper before and after timing,
including all eight PEReader/SRM groups and available CIL/Native method
boundaries. Every timed `inspectPE` snapshot is fully hashed outside timing.
Those guards support correctness for the measured fixtures and public shapes;
they do not constitute every platform, browser, or native-execution gate.

The byte-exact retained native capture is
`bdb094d3714b593bf70a1bac84bb456def0052c0019dc0ecedf1d4b8b2e298e4`;
its manifest is
`9e56632f1210f44eedf55b9652b719932511c82fddf519cda615ae3386b18760`.
The independently captured toolchain is SDK 10.0.201, runtime 10.0.5, with
Roslyn `5.3.0-2.26153.122`. The benchmark replays that retained native evidence;
it does not perform a new native capture.

The 71,432-byte ReadyToRun image has SHA-256
`d34230d85e2dcdd7965812fa9f103e1ea3ebad47a6ec44f60efc5ced0b397c68`.
The 34,816-byte mixed-mode image has SHA-256
`1bcc83a9da94aeebf0a57f02f254a15e8aebc9157b3e299cb53d1ebc3ce53667`.
Both match the exact manifest. Reports retain scalar facts and hashes, with no
input executable, IL, debug, or signing payload copies. Neither image is
executed. Native instruction disassembly, ReadyToRun method mapping, signature
verification, and platform execution remain outside this inspection benchmark.

## Three concrete source opportunities

### Build each directory record once

In `packages/cil/src/pe/optional-header.js`, the decoder first creates sixteen
zero-valued standard-directory objects, then replaces the advertised entries
with newly decoded objects. An ordinary sixteen-directory image discards all
sixteen initial records. This pattern also exists in the baseline, so its
presence does not prove that it caused the new regression.

Allocate the same sixteen-slot result array, fill advertised entries once, and
create only omitted trailing standard entries. Preserve its length, the name
sequence, each record's `name`/`rva`/`size` field order, and the identity aliases
from the `directories` map. Keep the minimum 15 and maximum 64 advertised-entry
bounds, the upfront byte-extent check, handling of additional directories, and
all scalar reads. Never return a sparse array.

### Avoid the conditional empty header spread

In `packages/cil/src/browser/summary.js`, the ordinary header constructs the
conditional object in `...(includePE ? { pe: ... } : {})` even though the
default header has no PE snapshot. Build the fresh header and assign its `pe`
field only when requested. Keep every field in the same order, validate and
evaluate PE options only for the opt-in case, and preserve ownership. This is
a source-level simplification; no claim is made that V8 materializes every
syntactic temporary or that this change has a measurable effect.

### Populate facts into the fresh destination

`methodCodeFacts` creates a wrapper that `decodeMethod` and metadata-only/error
summary construction immediately spread into a new method record. Let the
shared helper populate the caller's fresh destination instead. Classify exactly
once using the same validating `methodCodeKind` helper; append `codeKind` and
then a newly owned `disassembly` record at their existing positions. Preserve
subsequent method/error field order and the available, absent, unavailable, and
not-disassembled distinctions.

Do not store the destination on the definition, share a mutable nested result,
or cache classification from a mutable public definition. The metadata-only
path must still re-evaluate its definition on every request. Existing public
method cache identity and decoder behavior stay unchanged.

## Work retained and changes excluded

The enriched mandatory reader observes additional PE scalar fields and four
stack/heap UInt64 values. That work is part of `readPE`'s returned correctness
contract; do not defer those observations outside timing. `imageKind`, method
implementation facts, cancellation checks, and Native/OPTIL/Runtime/unmanaged-IL
body admission also stay intact. Fresh snapshots and precise integer/bounds
validation are requirements, not dispensable benchmark overhead.

The optional-header record is copied into a wider reader result, but redesigning
that parser return contract is outside this construction pass. `inspectPE`
validates normalized settings more than once; that affects the new API and does
not explain the ordinary controls. Changing it is also outside this pass.
No mutable definition/result cache, parser redesign, weakened guard, alternate
workload, or narrowed correctness contract is recommended.

## Qualification and disposition

After the three changes, run the focused correctness gate and exactly one new
cohort with the same inputs, call/batch counts, order, guards, and timing region.
Pin the new product explicitly. Keep the original native capture's source
hashes unchanged and record optimized replay source identity separately. Any
comparison of the optimized product against retained raw native facts is replay
qualification; it cannot be called a fresh PEReader/SRM capture.

The original offline native-reference test explicitly requires current files to
match the original capture hashes. A new source version needs an explicit replay
binding or a separate reviewed capture path before that gate can qualify it;
changing the hashes in the old capture would misrepresent historical evidence.

Retain both complete benchmark cohorts even if the second remains unfavorable.
Evaluate any remaining regression with the actual new results and explicit
quantified PR justification/sign-off. Passing output guards does not waive the
5% budget. This review neither dismisses the first measurements nor grants a
blanket exception for required functionality. The Project #6 reconciliation
audit was not modified by this review or evidence retention.

## Subsequent qualification decision

The coordinating implementation review selected a fresh two-image native capture
after the three source edits. Keep the offline test's and benchmark's strict
live-source hash assertions unchanged. The fresh capture will use the unchanged
pinned observer, tools, and images, followed by the same 130-test scope and one
unchanged benchmark cohort. That work is pending the assigned serial validation
slot. The original native capture and all original source receipts are archived
above before any product change or new capture. This decision does not alter the
independent review or claim that qualification has already run.
