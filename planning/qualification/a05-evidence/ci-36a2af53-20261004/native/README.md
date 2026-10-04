# Completed A05 native matrix — 2026-10-04

All eight jobs in [run 37229843614](https://github.com/wieslawsoltes/SharpForge/actions/runs/37229843614)
succeeded on pushed commit `36a2af53287a563fd47d3a33b8e6e6382a726d35`, tree
`da3add4a11cce5ed887d2a093eac4b48a4c26754`. This is actual remote CLR evidence;
no fixture, native output or report was regenerated during archival.

| Standard cell | Actual SDK | Passed | Failed | Unsupported |
| --- | --- | ---: | ---: | ---: |
| Ubuntu / SDK 8 | 8.0.425 | 30 | 0 | 4 |
| Ubuntu / SDK 10 | 10.0.201 | 33 | 0 | 1 |
| Windows / SDK 8 | 8.0.425 | 31 | 0 | 3 |
| Windows / SDK 10 | 10.0.201 | 34 | 0 | 0 |
| macOS / SDK 8 | 8.0.425 | 30 | 0 | 4 |
| macOS / SDK 10 | 10.0.201 | 33 | 0 | 1 |
| **Total standard cases** | | **191** | **0** | **13** |

The 13 unsupported outcomes remain separate from passes:

- Nine SDK 8 numeric records are explicit policy exclusions: `numeric-conversions`,
  `numeric-capture` and `numeric-replay` on each operating system. Those protocols
  pin the .NET 10 JIT; these records are not executed SDK 8 parity results.
- Four Unix managed-varargs executions captured the exact CLR
  `System.InvalidProgramException: Vararg calling convention not supported.`
  rejection. Their separately authored VM traces passed, without native parity.
  Both Windows managed-varargs comparisons passed against the actual CLR.

The standard `byref-calls` and `native-width` cases retain actual native output,
source and assembly hashes, and matching source/reloaded-source/compiled-CIL
results. Runtime probes observed 64-bit X64 processes on Ubuntu and Windows and
64-bit Arm64 processes on macOS. Standard SDK 8 guests actually ran .NET 8.0.31;
standard SDK 10 guests actually ran .NET 10.0.12.

Two additional Windows x86 jobs independently qualified the width fixture, outside
the 204 standard-case total. SDK 8.0.425 ran .NET 8.0.31 and SDK 10.0.201 ran
.NET 10.0.5. Both probes reported `win-x86`, `X86` and `IntPtr.Size == 4`; every
configured VM route used 32 bits and matched the observed native output. The
installation records, official installer URL/hash, exact SDK/config/probe/source
hashes and final width assertions are retained.

The complete SDK 10 numeric replay passed on all three operating systems. Raw
aggregate durations were 793041.222449 ms on Ubuntu, 635358.4794000001 ms on
Windows and 603314.8634159999 ms on macOS, each under the recorded 1800000 ms
correctness deadline. These are qualification durations, not performance gates.
The earlier Windows 312 result with its 900000 ms deadline remains unchanged.

[manifest.json](manifest.json) records all eight original artifact/job IDs, URLs,
uploaded ZIP digests and retained-file hashes. Every ZIP digest was verified, every
one of the 204 case records was checked against its aggregate, and the selected
raw payloads retain original bytes, including Windows CRLF. Repeated source,
expected-output, runtime-config and probe inputs are stored once under their
content hash. There are 1089 unique retained payload files.

Managed DLLs, compressed numeric payloads, large generated numeric result arrays
and other omitted entries remain traceable in each artifact's `omittedFiles`
inventory. They were not materialized. Each downloaded reproducible ZIP was
removed only after its selected payloads, per-file hashes and uploaded digest
were verified. GitHub retains the original artifacts for 14 days.

This matrix does not make repository core green: the same-tree PR merge failed
the separately recorded A01 legacy-adapter assertions. It also does not qualify
later runtime optimizations or A01 repairs. See [CI status](../ci-status/README.md)
for those distinctions and the cancelled preceding ca97 matrix.
