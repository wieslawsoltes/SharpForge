# Completed A05 native matrix — 2026-10-04

All six standard jobs in [run 37225004330](https://github.com/wieslawsoltes/SharpForge/actions/runs/37225004330)
completed successfully on pushed commit `312cd9242a492ce6f03e7e034a51cc17669a7edf`,
tree `21dd929c4087bb7dc97fdd735d88ae36d1e76050`. The final macOS SDK 10 job finished
its numeric replay at 19:26:55 UTC. Every original aggregate contains 34 case outcomes.

| Cell | Actual SDK | Host architecture | Passed | Failed | Unsupported | Aggregate status |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Ubuntu SDK 8 | 8.0.425 | x64 | 30 | 0 | 4 | partial |
| Ubuntu SDK 10 | 10.0.201 | x64 | 33 | 0 | 1 | partial |
| Windows SDK 8 | 8.0.425 | x64 | 31 | 0 | 3 | partial |
| Windows SDK 10 | 10.0.201 | x64 | 34 | 0 | 0 | passed |
| macOS SDK 8 | 8.0.425 | arm64 | 30 | 0 | 4 | partial |
| macOS SDK 10 | 10.0.201 | arm64 | 33 | 0 | 1 | partial |

The 204 case outcomes comprise 191 passes, zero failures and 13 explicit unsupported
results. Job success does not turn a `partial` aggregate into a full pass.

- `numeric-conversions`, `numeric-capture` and `numeric-replay` are excluded on SDK 8
  because the numeric conversion policy and generated oracle explicitly qualify
  the .NET 10 JIT. These nine outcomes are not executed native comparisons.
- Managed varargs actually ran on all six hosts. Ubuntu and macOS on both SDKs
  terminated with `SIGABRT` and the exact CLR error
  `System.InvalidProgramException: Vararg calling convention not supported.`
  Those four outcomes retain raw native failure provenance and an independently
  passing VM authored trace, explicitly without native parity.
- Windows SDK 8 and SDK 10 executed managed varargs normally and passed the full
  native-output comparison. No platform preskip or general exception suppression
  produced these outcomes.

The original `qualification.json` and every case's `result.json`, available stdout,
stderr and detailed qualification report are retained under each cell directory.
They include exact commands, exit/signal observations, source/assembly hashes,
native and VM outputs, and SDK/runner/revision provenance. All original case reports
are retained, including the unsupported native processes and policy exclusions.

## Actual runtime and ABI observations

The native-width and byref fixtures compare the same Roslyn DLL with direct CIL,
then compare the exact C# source through source, reloaded-source and compiler-emitted
CIL routes. Their independent runtime probes use the same guest executable and
runtime configuration. The native-width probes observed:

| Cell family | SDK 8 guest | SDK 10 guest | Process / native width |
| --- | --- | --- | --- |
| Ubuntu | .NET 8.0.31 | .NET 10.0.12 | X64 / 64 bits |
| Windows | .NET 8.0.31 | .NET 10.0.12 | X64 / 64 bits |
| macOS | .NET 8.0.31 | .NET 10.0.12 | Arm64 / 64 bits |

All three source routes terminated and matched the actual native trace in every
byref/native-width case. The adjacent dedicated Windows x86 archive separately
proves actual 32-bit execution; its SDK 10 guest was .NET 10.0.5. The installed
runtime list alone is not treated as proof of a guest runtime patch, and the width
probe's patch observation is not invented for fixtures that did not run that probe.
Node was v22.23.3 on Ubuntu/Windows and v22.23.2 on macOS.

## Full numeric replay

All three SDK 10 numeric-conversion, fresh native-capture and full replay cases
passed. The original recorded replay durations were:

| Platform | `durationMs` | Original deadline |
| --- | ---: | ---: |
| Ubuntu | 796885.441884 | 900000 ms |
| Windows | 898913.3383999999 | 900000 ms |
| macOS | 470140.0195 | 900000 ms |

Windows passed with 1086.6616 ms remaining. A later qualification-budget change
does not alter this run's recorded deadline or result, and no actual timeout is
claimed. The native capture provenance, generated C# inputs, short traces and replay
logs are retained. Bulk numeric output and conversion/storage payloads remain in
the original artifacts with hashes recorded by their original provenance files.

## Integrity and retained scope

[manifest.json](manifest.json) records six original artifact IDs, URLs, sizes,
verified ZIP SHA-256 values, job IDs, outcomes, retained entry paths and hashes.
Every ZIP digest matched GitHub's upload digest before selective extraction.
No product code, fixture, assembly, trace or report was regenerated during archival.

Exact duplicate source/probe files, expected traces and runtime configurations are
stored once under `inputs/<sha256>/`; each manifest entry maps its original artifact
path to that byte-identical retained file. Reports keep their original paths and
contents. Generated DLLs and compressed/bulk numeric payloads are omitted; their
entry names and sizes remain in the manifest, and their original artifact remains
addressable. Raw ZIPs are retained in the external archival workspace, not duplicated
in Git. GitHub artifact retention is 14 days, so omitted bytes are not guaranteed
permanent by this compact archive.

These results qualify the exact public `312cd924…` product. Later runtime repairs,
benchmark candidates and added browser cases need their own validation. The separate
repository core failure tested merge `4802e738…`, tree `90a9350e…`, and is not converted
into a pass by these focused push jobs.
