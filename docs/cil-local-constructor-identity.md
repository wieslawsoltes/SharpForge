# Local constructor identity in managed CIL

The canonical consumer replay at `43fa19c425700e1c4703190f100239c06dd97a75`
compiled both of these existing inputs successfully, then faulted during CIL execution:

| Existing input | Observed execution failure | Preserved expected output |
| --- | --- | --- |
| Source `Shape` and `Button` in `compiler-canonical-managed-replay.test.js` | `Field declaring type does not match the receiver` | `3mine\n` |
| Pinned `member-initializers/nested-object-initializer-reads-the-member-each-time` | `Call receiver has no matching declaring instance` | `2\n1 2 3 0\n0\n` |

The complete 74,196-byte original replay is retained losslessly in
[the evidence directory](evidence/project5-local-constructor-identity/), together
with its unmodified launcher manifest and the two complete failure observations.
Its uncompressed SHA-256 is
`7b57bbfc9e2bc9528980283cd5d93a35b83074fa3d2e862fde4fc277be116b9b`.
The nested initializer's source and existing Roslyn pin remain unchanged.

## Cause and correction

The compiler's member-token emitter selects the local constructor's `MethodDef`.
`resolveExecutionMethod` carries the resolved local definition into runtime call
selection. The CIL verifier already gives that local body priority, and the method
table registry preserves explicitly defined local names.

Runtime call selection nevertheless looked up a framework intrinsic for every
descriptor. Framework alias lookup maps the short names `Button` and `Line` to
their WinUI types, whose registered parameterless constructor signatures match.
The `newobj` framework-contract branch preceded local allocation, so it created
the framework object and skipped the source constructor. The subsequent local
field or getter access correctly rejected that object's unrelated method table.

The existing call-selection seam now skips intrinsic lookup when a concrete
local method target has been resolved. The ordinary local allocation and
constructor-body path therefore runs. This aligns runtime construction with the
verifier's existing selection order. Unresolved external constructors still use
their registered contracts, and the separate managed delegate path retains its
existing behavior. Field ownership and method receiver checks keep their exact
rejection conditions.

There is one production-line change, in
`packages/runtime/src/execution/calls.js`. There is no compiler emission change,
profile conversion, or new admission exception.

## Focused controls and replay results

`tests/a05-local-constructor-identity.test.js` was committed before the production
correction. Its eight controls cover observable field initializers and constructor
bodies for both source names; simultaneous local and genuine framework `Button`
construction; an independent framework-only constructor and inherited property;
independently authored local `MethodDef` and `MemberRef` constructor operands;
both receiver guards against a framework namesake; and a source delegate named
`Button`. All compiled controls use ordinary PE/CLI without `#SF` metadata.

The exact test-only parent is
`bd91c105aa9fa1f765ae0d8254ca99783535df23` (tree
`d45f8adde2400164ff6c977cb32968ca7c3ce3aa`). The correction was tested at
`4ff5a1ccb789eabd69d82386304c2d4014e3a015` (tree
`5390c6cc03ed69672e80d54f04c4b761a3175856`). The candidate worktree remained
clean at that head throughout the completed captures. Source inventories and
hashes were checked before and after execution; no captured source changed.

| Completed capture | Passed | Failed | Skipped | TAP duration |
| --- | ---: | ---: | ---: | ---: |
| Eight controls, test-only parent | 3 | 5 | 0 | 1,192.978 ms |
| Eight controls, corrected candidate | 8 | 0 | 0 | 1,082.884 ms |
| Both original replay files, corrected candidate | 2 | 5 | 0 | 2,259.633 ms |

The five parent failures were local `Button`, local `Line`, simultaneous local
and framework construction, and the independent `MethodDef` and `MemberRef`
fixtures. The independent framework constructor, receiver rejection guards, and
local delegate already passed on the parent; all eight pass with the correction.

Both original object failures now terminate with their existing expected outputs.
Their original source, expected output, Roslyn pin, replay instruction budgets,
and emitted PE bytes are unchanged:

| Original case | PE bytes | PE SHA-256 | Corrected output |
| --- | ---: | --- | --- |
| `Shape` and `Button` | 2,048 | `fb8148ddb6c4fb4ab285a02cf5133ab04ccb1bb88a56def97235498bc46086ab` | `3mine\n` |
| Nested object initializer | 2,560 | `19b0c702aeb5f034f1c0c83bf755930dee6d719dd00e42af37665d57fd7dc347` | `2\n1 2 3 0\n0\n` |

The other five cases in those files still fail at this candidate head: three
exception-region admission cases report `Invalid exception region input or
options`, one generic `List<T>.Count` case reports an unsupported external member,
and one tuple case reports unsupported external fields. Those separate failures
remain in the full raw replay; this change does not establish a passing result
for either whole replay file or for wider canonical CIL acceptance.

Two earlier incomplete attempts are also retained. The first parent export
omitted the symbols package's archive dependency, so it failed to import before
any authored control ran. A complete compiler/runtime dependency export then
produced the eight-control parent result above. The first original replay attempt
executed the four cases in its first file but could not import the second file's
compiler conformance support. Materializing that support from the same candidate
head produced the complete seven-case result above. No failing assertion,
instruction budget, source input, or expected result was adjusted for either
repeat.

The recorded commands use `scripts/limited.js`, Node's TAP reporter, and
`--test-concurrency=1`. The focused command is:

```sh
node scripts/limited.js node --test --test-concurrency=1 --test-reporter=tap tests/a05-local-constructor-identity.test.js
```

The original replay command names `tests/compiler-canonical-managed-replay.test.js`
and `tests/compiler-direct-cil-adjacent-replay.test.js` with the same options.
Complete launcher manifests, raw compressed logs, source inventories, and capture
scripts are listed in
[qualification-manifest.json](evidence/project5-local-constructor-identity/qualification-manifest.json).

## Paired dispatch measurement

The bounded benchmark compares the same exact parent and corrected candidate.
Its exported runtime dependency graphs differ only in
`packages/runtime/src/execution/calls.js`. The committed runner,
`packages/runtime/bench/local-constructor-identity.mjs`, is byte-identical to the
runner used for capture (SHA-256
`5e2388d1ca5c3f7814a9396d8ae388b0bef0299fa3169cfb3c62f912367c255d`).
The preserved paired driver records each explicit source revision and hash.

Each process runs an external-only `Math.Abs` loop and a local `Cell`
constructor/`Read` loop, each with 128 iterations. The local type deliberately has
no framework name collision, so both sides execute the same work successfully.
Each case has one preflight, 80 warmups, and 24 measured samples per process. The
fixed eight-process order is A, B, B, A, B, A, A, B, giving 96 measured samples per
side and case. All processes completed; no performance rerun was taken.

This is the JavaScript direct CIL VM with `virtualTime: true`,
`wasmTiering: false`, and `maxInstructions: 100_000`. Node was 24.19.0 with V8
13.6.233.17-node.51 on a shared Linux x86-64 host reporting an AMD EPYC 9V74
80-Core Processor and nine available logical CPUs. No native or Wasm throughput
claim is made.

Every run checks its terminated state, empty output, return value 8,256, and
finite nonnegative timing, instruction, allocation, and allocated-byte fields.
PE hashes and execution counts remain equal both within each process and across
all eight processes and both revisions:

| Workload | PE bytes | Instructions | Managed allocations | Managed allocated bytes |
| --- | ---: | ---: | ---: | ---: |
| External-only | 1,536 | 1,542 | 0 | 0 |
| Local constructor and call | 1,536 | 2,694 | 128 | 5,120 |

The external PE SHA-256 is
`f4104d65d8884200f1a1a321834756ab4909ac9ec77e9d05286c888731e456ac`.
The local PE SHA-256 is
`f31e9268380a720870731d3830c299afae8423a0f6567af50af8234117bc21a6`.
Admission, execution, and total elapsed time were measured separately. The
following aggregate values retain every measured sample; values are milliseconds:

| Workload and phase | Parent median | Candidate median | Median change | Parent p95 | Candidate p95 | p95 change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| External admission | 0.487076 | 0.555481 | +14.04% | 1.448237 | 1.069317 | -26.16% |
| External execution | 1.906129 | 2.009478 | +5.42% | 3.421426 | 3.565162 | +4.20% |
| External total | 2.600266 | 2.711303 | +4.27% | 4.156005 | 4.309655 | +3.70% |
| Local admission | 0.762936 | 0.819659 | +7.43% | 2.730280 | 1.204329 | -55.89% |
| Local execution | 5.547404 | 6.744517 | +21.58% | 8.920403 | 8.055463 | -9.70% |
| Local total | 6.547100 | 7.637509 | +16.65% | 10.119370 | 9.463323 | -6.48% |

Five median measurements exceed the 5% budget: external admission and execution,
and local admission, execution, and total. The full report retains all eight
process outputs, all raw samples, per-process summaries, aggregate median/p95,
source inventories, and every threshold breach. Its uncompressed SHA-256 is
`b4fbdf39f488d71442654fa95118c24b707f839a4bbe36ef1b85f805ef1d0b49`;
the lossless record is
[dispatch-paired.json.gz](evidence/project5-local-constructor-identity/dispatch-paired.json.gz).

### Explicit performance budget exception

On 2026-10-04 the coordinating author/reviewer (`/root`) reviewed the full
96-sample-per-side report and accepted the measured budget exception for the
one-line correction at `4ff5a1ccb789eabd69d82386304c2d4014e3a015`, contingent on
the standalone publication tree passing the eight focused controls. The review
explicitly accepted local total median +16.65% (+1.0904 ms for 128 constructions
and calls), local execution median +21.58% (+1.1971 ms), local total p95 -6.48%,
external total median +4.27%, external execution median +5.42%, and external
admission median +14.04%, with the other measured values above preserved.

Restoring legitimate local `MethodDef` identity while retaining the receiver
checks justifies this captured correctness cost. This is an accepted exception,
not a passing speed budget or evidence that the single line caused all latency
variation. The shared host and differences between processes limit broader
performance conclusions. No repeat or extra optimization was requested for this
batch.

## Standalone publication qualification

The publication branch starts at qualified main
`41ebd76987aa912659310d4015607f46110358ab` and preserves the four owned source,
test, and evidence commits through `-x` cherry-picks. The canonical consumer
branch's `43fa19c425700e1c4703190f100239c06dd97a75` head is not an ancestor.
The four-commit source head had 31 changed file blobs, each matching the preserved
source branch at `e4936627b3642085924c55e5aed5eafaeb948e21`. Its only production
source difference from main is the single call-selection line described above.

On 2026-10-04 the clean publication source head
`cdfcf495c6988989fba501441f52e6f2ea25a2b4`, tree
`3ab91c5692092db66985f90a0f49f03b2166fb21`, passed all eight focused controls:
8 passed, 0 failed, 0 skipped. TAP duration was 1,395.765241 ms; launcher wall time
was 1.639428515 seconds. Every materialized Git blob, all 14 package aliases into
the isolated publication worktree, HEAD, and clean worktree status were checked
before and after execution and remained unchanged. The launcher retained all
three pinned DOTNET environment variables. Assertions and instruction budgets
were unchanged, and no additional timing run was performed.

The raw 2,224-byte publication log has SHA-256
`59bcd41ae09c80802a82b710b81dbabbee82aa97e47c2fd1e0a368d0a34e683e`.
Its launcher report, source inventory, preparation/provenance record, capture
script, and lossless log are included in the evidence manifest. This successful
publication replay satisfies the condition on the explicit performance budget
exception above. The later publication evidence commit changes documentation and
evidence only; the qualified production and test sources remain those at the
recorded publication source head.

Project #5's wider canonical CIL acceptance work remains open. This batch did not
run a native, browser, or Wasm replay; its executed qualification covers the
focused JavaScript CIL controls, the two original replay files, and the bounded
paired benchmark described above.
