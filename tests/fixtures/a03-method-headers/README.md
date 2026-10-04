# SF-A03-T05.4 method-header qualification

Status: **authored, unexecuted**. The implementation is based on exact main
`e60b0764782f1122439e5b161cb9494c75724e32`, including the merged reference-output
contract. No current fixture or planned command is a passing observation.

`Program.cs` uses native System.Reflection.Metadata to read raw tiny/fat header
bytes, MaxStack, initialization, local signatures, code and EH clauses. It also
decodes authoritative method/call-site signature facts, independently of the
product signature reader. A collectible CoreCLR context invokes public static
parameterless methods and records load and execution errors separately.

`corpus.cs` covers simple methods, a ten-argument call, loops, filter/finally,
dynamic stack allocation, function-pointer calls and repeated property patterns
whose direct emission inserts flag resets. Roslyn and SharpForge compile the
same source; execution results are compared. Every supported body is analyzed
using the SRM-decoded signatures, with exact fat-header equality and explicit
tiny-header maxstack eight. Different emitted IL may legitimately have different
peaks; there is no assertion that different instruction graphs have equal peaks.

`input.js` generates independent IL text for pinned native ILAsm and product
images through the public body writer. The boundary cohort covers 1/63/64 code
bytes, peaks eight/nine and zero with a local signature. Underflow and inconsistent
join inputs are retained as native negative fixtures, expecting JIT rejection
and analyzer `invalid`. Product boundary code bytes and header eligibility are
compared with the independent assembler output. The unit tests additionally
cover filter and filtered-handler roots, nested try coincidence, fault, leave,
prefix interiors, terminal residues, cancellation, limits and unknown effects.

Run only in the coordinated serial validation slot, from the worktree root:

```sh
node scripts/limited.js node --test tests/a03-05-decoding-limit-tags.test.js tests/a03-05-maxstack.test.js tests/a03-05-maxstack-eh.test.js tests/a03-05-method-headers.test.js tests/a03-05-compiler-method-headers.test.js tests/a03-06-eh-encoding.test.js
SHARPFORGE_ORACLE_DOTNET=/path/to/dotnet SHARPFORGE_ILASM=/path/to/ilasm node scripts/limited.js node tests/fixtures/a03-method-headers/capture.mjs artifacts/a03-method-headers-FIRST-HEAD
```

The capture uses the repository's pinned SDK 10.0.201, CoreCLR/reference pack
10.0.5, Roslyn hash and ILAsm hash. Tools are externally provisioned; the capture
does not install anything. The output directory must be new. All exact process
arguments, status/stdout/stderr, source bytes/hashes, produced DLLs, native
observations and product analysis results are retained, including on failure.
The helper toolchain's independently pinned identity and environment are recorded.
Root execution provenance additionally records the exact source/tool revision.
The capture records all four toolchain probes and seven workload processes through
the canonical native runner. Each admitted command is saved before launch, with
public execution settings, bounds and timestamps. Separate output logs and hashes
retain the runner's stdout/stderr strings, including the partial `error.result`
returned on timeout or output overflow. Source copies precede the first probe.
This recorder correction changes no product or fixture input bytes. Its focused
failure-retention test is `tests/a03-05-header-capture.test.js`; native success
remains unqualified until the actual capture completes.

The existing reference-output public/friend native capture is a separate
regression gate. It must preserve the refout contract and native/IL findings;
it must not require unchanged header/RVA/PE bytes if an explicitly integrated
header policy later changes their encoding. Default legacy emitter replay and
IL-document no-change bytes remain exact requirements.
That unchanged compatibility driver retains native observations and consumer
compiler logs, but discards successful non-consumer subprocess stdout/stderr and
deletes its temporary build workspace. The external recorder retains its outer
process output and produced artifact directory; it cannot recover those discarded
inner outputs or claim complete inner-process provenance for this compatibility gate.

## Performance preparation

`packages/cil/tools/benchmark-method-headers.mjs` measures direct
`compileToAssembly`, with `controls.cs` and `corpus.cs` as separate workloads.
Baseline is exactly `e60b0764782f1122439e5b161cb9494c75724e32`; candidate is the
frozen implementation head. Each of the four runs uses a fresh process, the
same driver/input bytes, and its selected checkout's own public package aliases.
Neither compiler nor CIL is imported before the selected compiler import timer.
First compilation excludes import; all 121 chronological observations are
retained: first compile, 20 warmups and 100 measured compilations. Median is the
mean of the middle pair; p95/p99 use nearest rank. Per-sample success and byte
determinism checks run outside the timer, with mode/header guards on the first
result. The driver refuses a reused output path and records partial failures.

Prepare these commands with absolute frozen checkout/output paths; execution
requires the sole quiet-machine slot:

```sh
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-method-headers.mjs --compiler /baseline/packages/compiler/src/index.js --headers legacy --workload controls --output /evidence/baseline-controls.json
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-method-headers.mjs --compiler /candidate/packages/compiler/src/index.js --headers auto --workload controls --output /evidence/candidate-controls.json
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-method-headers.mjs --compiler /baseline/packages/compiler/src/index.js --headers legacy --workload corpus --output /evidence/baseline-corpus.json
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-method-headers.mjs --compiler /candidate/packages/compiler/src/index.js --headers auto --workload corpus --output /evidence/candidate-corpus.json
```

Report whole-checkout scope, ordinary compile/import/first-compile latency,
intentional header/PE size changes, and per-method IL hashes. Heap deltas are
temporary-inclusive observations, not total allocations or retained-heap
measurements. No speedup or regression claim exists before these runs. Changes
over 5% latency or 10% size require the project's explicit review/sign-off.

Changes outside A03 are limited to the compiler's `emit/cil/il-builder.js` and
`emit/cil/assembly-emitter.js` plus its README, using the public CIL exports.
The fifth handler-entry policy option preserves existing verifier defaults.
Canonical decoder errors retain their prior `.code` and messages, adding only
structured count-limit tags. No planning claims, live table-owner leaves,
legacy emitter/loader orchestration or compiler-index hot lock are changed.
Issue #2391 remains open for legacy integration and qualification; inherited
schema prerequisite #8 remains unqualified.
