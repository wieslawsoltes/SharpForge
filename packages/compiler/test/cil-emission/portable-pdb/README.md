# Direct CIL Portable PDB qualification

SF-A02-T29 / #610. The producer is implemented through the public `@sharpforge/symbols` writer and attachment APIs.
Direct assembly symbols are explicitly enabled by `portablePdb: true` or `embeddedPdb: true`; explicit `portablePdb: false` disables both.
Unavailable mapped documents carry a nil checksum, or the exact `#pragma checksum` declaration, and are never embedded as invented source.

## Verified scope

At source head `0ac4fd7fec948991c2375306058d5847a0276889`, all **22 targeted tests passed with no skips**:
six public document-writer tests, fifteen direct CIL producer tests, and one independent native qualification test.
The producer tests cover compact branch relaxation, exact instruction boundaries, unchanged emitted instructions and exception clauses,
nested local slots/scopes, exact constants, partial-type initializers, stack allocation streams, complete constructor stores/calls,
`#line`/enhanced-line/hidden mappings, missing mapped source, diagnostics, deterministic sidecar/embedded options,
async and iterator links, await offsets, hoisted local lifetimes, and selected entry point exception stepping.

The native test builds the repository's C# `System.Reflection.Metadata` reader and a live Roslyn reference application with
.NET SDK **10.0.201**, reference pack **10.0.5**, `net10.0`, C# 14, portable symbols, and optimizations disabled.
Microsoft.NETCore.App **10.0.5** was the sole installed runtime for these executions.
It compares every produced document, sequence point, scope, constant signature and custom debug record through the independent reader.
Both emitted symbol delivery modes execute on .NET and match Roslyn's output:

```text
42
1
2
True
```

The final `True` checks the thrown exception's mapped `view.cs:line 123` stack frame.
The embedded run removes the PDB sidecar before execution. The raw pass output is in [final-tests.log](final-tests.log);
toolchain, source hashes, exact heads and observations are in [qualification.json](qualification.json).

## Actual failures retained

The initial stackalloc repro emitted no sequence points where source lines 2 and 3 were expected.
`6a6b596c` reconnects the optional collector after the typed instruction stream replaces the ordinary stream.

The first live Roslyn run exposed an enhanced `#line` boundary error: `(201, 8)` has an inclusive directive end,
so the emitted Portable PDB sequence point ends at column **9**. `5d0eb579` corrects the conversion and both tests.

The next live reference run established that the selected async `Main` also receives an async debugger catch entry.
`50d59b8f` and `0ac4fd7f` connect that decision to the compiler's actual entry point selection, including top-level `await`.
Library methods and async `Main` methods that lose selection to a synchronous entry point remain ordinary Task methods.
The raw failing outputs are retained in [boundary-repros.log](boundary-repros.log). None are represented as earlier passes.

The source-side rule is independently visible in Roslyn's
[MethodCompiler.cs](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Compiler/MethodCompiler.cs)
(retrieved Git blob `86855e8e608ef7a71bd8e77c26507868a23600cc`).
Source mapping follows the
[enhanced line directive proposal](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-10.0/enhanced-line-directives.md)
and [Portable PDB metadata specification](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md).

## Performance

The exact pre-PDB integration parent is `dcc43cfe1de9326ea1f26a97c13d83203f2fde00`.
The measured candidate is `16a5684c46dbe0aa04d081d81bf8d720e6f40299`, which changes only the benchmark after the tested production head.
Both execute the identical benchmark script (SHA-256 in the JSON) using Node **v24.19.0**, Linux x64,
on an **AMD EPYC 9V74 80-Core Processor**. One limiter slot covers both child processes; no team validation job ran concurrently.
The temporary baseline uses a packages-only sparse worktree and is removed after capture.

The corrected method warms both options 150 times, then alternates seven batches of 40 compilations per option.
Reported percentiles are over the seven per-compilation batch averages.

| Mode | Before median / p95 (ms) | Candidate median / p95 (ms) | Candidate PE / PDB bytes |
| --- | ---: | ---: | ---: |
| `portablePdb: false` | 3.131 / 3.908 | 2.744 / 3.228 | 4,096 / 0 |
| `portablePdb: true` | Unsupported option; ignored | 4.422 / 5.658 | 4,608 / 1,150 |

The default PE size remains 4,096 bytes in this workload. Enabling symbols intentionally adds 512 PE bytes and a 1,150-byte sidecar.
The extra PE output belongs to the explicitly requested debug payload. No allocation count was measured.

This run shows no default-path timing regression. It does **not** establish a speedup: the shared host still shows variation,
including different timings for the two baseline options even though that compiler ignores the flag.
The first sequential, ten-warmup pilot showed a much stronger order effect and is explicitly superseded.
Both the corrected samples and the invalid pilot are retained in [benchmark-results.json](benchmark-results.json).

Reproduce the targeted test with an installed SDK/reference pack:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a13-document-only.test.js \
  tests/compiler-cil-portable-pdb.test.js \
  tests/compiler-cil-portable-pdb-reference.test.js
```

Point `DOTNET_ROOT`, `DOTNET`, and `PATH` at the intended SDK. The native test reports an explicit skip if it is absent;
the captured run above did not skip. The benchmark command, run once per exact head with the same script, is:

```sh
node scripts/limited.js node packages/compiler/bench/portable-pdb.bench.js
```

## Remaining limits

This producer does not reconstruct Edit and Continue or closure-capture maps.
Local variables whose only scope is a lowered query clause or switch expression arm are omitted when no dedicated emitted scope exists;
the containing source statement is still mapped. These are explicit source-level producer limits, not invented optimized local ranges.
This targeted qualification does not claim the repository-wide core/build/full-suite gate.
