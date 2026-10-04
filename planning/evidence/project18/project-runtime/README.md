# Project 18: separate assembly runtime qualification

Product source: `b7271de11951bf58eeb2a6f2159d3c607cfd1c46` on
`codex/p18-tests`. The [qualification record](qualification.json) contains exact
commands, toolchains, source commits and log hashes. The
[projection inventory](../testing-projections.json) maps 116 owned files to 14
review units, with a Git blob and SHA-256 for each file. It is a publication input,
not a claim that an untested projected or remote tree passed these checks.

## Correctness

| Capture | Node | Files | Passed / total | Skipped | Result |
|---|---|---:|---:|---:|---|
| [Initial joint scope](node22-initial.tap) | 22.23.3 | 37 | 362 / 372 | 0 | Retained failures |
| [Completed correction scope](node22-corrected.tap) | 22.23.3 | 46 | 408 / 409 | 0 | Static readonly assertion remained |
| [Readonly follow-up](node22-readonly.tap) | 22.23.3 | 1 | 11 / 12 | 0 | Exposed imported private setter metadata defect |
| [Final affected scope](node22-properties.tap) | 22.23.3 | 13 | **68 / 68** | 0 | Passed |
| [Final complete scope](node26-final.tap) | 26.10.0 | 48 | **415 / 415** | 0 | Passed |

Every invocation used `scripts/limited.js` and `--test-concurrency=1`. The final
Node 22 follow-up covers the complete property/accessor correction and the new
banner extraction, plus affected graph, worker, debugger and initializer cases.
It does not pretend to be another full Node 22 run.

The separate-PE oracle compares a Roslyn SDK build on the CLR, separately emitted
SharpForge PEs on the CLR, the source VM and the direct CIL VM. All produce
`42`, `42`, `44`, `null` on separate lines. The capture reports SDK 10.0.401,
MSBuild 18.9.11.42413 and runtime 10.0.5 on Linux x64. A separate readonly fixture
uses SDK 10.0.201/runtime 10.0.12. The diagnostic probe is retained in
[project-reference-readonly-diagnostics.json](../project-reference-readonly-diagnostics.json).

The first failures led to concrete fixes: actual `.cctor` bodies now participate
in source initialization; linked source debug maps retain valid local IL tokens
and offsets; generated default constructors retain their public access; and
property associations/accessor access survive emission and canonical loading.
The static readonly assertion now uses the SDK-confirmed `CS0198`; instance
readonly remains `CS0191`. The private setter assertion remains `CS0272` and now
passes. No write-rejection assertion was removed.

## Runtime behavior

Explicit dependency bytes are verified against full assembly identity, SHA-256
and the canonical SharpForge profile before execution. Source execution uses
`loadProjectAssembly`; direct CIL uses `createProjectAssemblyInspector`. The
composite inspector maps original modules into bounded, disjoint token ranges
and retains the ordinary dispatcher, heap, static state and scheduler.

The graph loader owns source URI collision mapping. Runtime and debugger records
retain assembly identity, original URI, local MethodDef token and supplied
project/context provenance. Editor navigation uses matching text and context;
unmatched embedded sources remain read-only. The source and CIL stack helpers
preserve their existing execution addresses and add physical module provenance.

The worker cache includes dependency bytes and context provenance. Invalid
replacement input preserves the existing session. Multi-module Hot Reload and
external PDB replacement require a full relaunch. Runtime dispatcher files were
not edited. The frozen debugger tools file shrinks from 64 lines / 20,312 bytes
to 56 lines / 17,867 bytes after extracting the stop banner.

## Performance evidence and unresolved review

The unchanged `scripts/benchmark-release14.js` ran serially on Node 22.23.3,
comparing upstream `2e700ad8` with the product source above. Two alternating pairs
completed, giving eight warm samples per workload and tree. A third baseline
completed; its matching final process never launched because the disk preflight
failed. That unmatched baseline is retained but excluded from comparison.

| Workload | Engine | Median before → after (ms) | Median change | p95 before → after (ms) |
|---|---|---:|---:|---:|
| Dictionary | Source | 30.280 → 32.481 | +7.27% | 36.188 → 40.980 |
| Dictionary | CIL | 91.065 → 93.849 | +3.06% | 153.963 → 113.128 |
| List | Source | 30.190 → 32.517 | +7.71% | 38.896 → 36.982 |
| List | CIL | 241.922 → 240.685 | −0.51% | 283.761 → 259.546 |
| Queue | Source | 18.011 → 15.892 | −11.76% | 26.732 → 21.876 |
| Queue | CIL | 106.573 → 102.519 | −3.80% | 166.049 → 110.193 |
| StringBuilder | Source | 14.877 → 15.391 | +3.46% | 36.967 → 30.949 |
| StringBuilder | CIL | 48.808 → 64.019 | +31.16% | 56.577 → 72.891 |

Managed heap allocated-byte counters are unchanged in every row. These are
shared-machine measurements under resource pressure, and the eight-sample p95
is the largest observed sample. They do not establish that resource pressure
caused any difference. Three median rows exceed the contribution budget and
remain an explicit performance review obligation. CIL StringBuilder is slower
in both measured pairs; the source List directions differ between pairs.

The [diagnosis](benchmark-diagnosis.json) checks the timing boundary and emitted
programs. Compilation and VM construction finish before the timer starts. All
four source instruction streams and decoded CIL opcode/operand sequences and local/handler counts
match between trees; there are no property tables, external references or
qualified source types. Graph, worker and debugger preparation are absent from
these standalone runs. The new canonical member profile adds 172 bytes to each
`#SF` stream; PE alignment takes the small StringBuilder fixture from 4,096 to
4,608 bytes (+12.5%), outside the timed region. This is not a Studio bundle-size
measurement.

No newly executed graph or provenance preparation was found to remove. The
cause of the timing regressions remains unresolved; no speculative runtime
optimization or additional benchmark repetition was made. See
[benchmark.json](benchmark.json) for raw samples, per-run load averages and exact
commands. The third pair and quiet-machine causal qualification remain pending.

## Boundaries and integration

This is a closed, nongeneric SharpForge class profile, not arbitrary CLR assembly
loading. External generic, virtual, abstract, by-reference and native constructs
remain explicit unsupported cases. No Windows, macOS or Rust/Wasm graph result
is claimed. Source initialization caches its original managed fault, while direct
CIL retains its existing `TypeInitializationException` wrapper; effects and
propagation agree, but identical exception object types are not claimed.

The all-member reference profile rejects private setters with `CS0272`. The
separate-PE Roslyn probe reports `CS0200` because it hides the private setter.
Exact diagnostic-code parity is therefore not claimed. Earlier pinned native
xUnit/NUnit/MSTest/coverlet qualification remains unavailable after the retained
single restore timeout; these runs made no further restore attempt.

The protected Studio entry remains unapplied in this worktree. The reviewed
[entry-hook document](studio-hooks.md) and assertion-checked transform are for
the root integration owner; no copied Studio entry was executed. Root owns
final application/browser qualification and publication of the dependency stack.
