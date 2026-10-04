# Return-lifetime byref stress requalification — 2026-10-04

The existing byref GC-stress selection passed **6/6 tests**, with zero failures,
skips or cancellations, at clean unchanged revision
`6cdd61291d79b609211e05624645225aeaa7d94c`, tree
`009e3ad2814fd596b305129be724c0adc06fb66c`.

The [original execution journal](execution.json) records Node v24.19.0 on Linux
x64, the exact serial command through `scripts/limited.js`, the 1/1/512 resource
controls, start/end identities and timestamps, and exit zero. The
[original TAP](byref-gc-stress.tap) reports `7831.351649 ms`; this is test duration,
not a measured performance improvement.

The [complete JSON report](byref-gc-stress.json) retains **1,000 distinct direct-CIL
assemblies**, with **131,341 instructions and exactly 131,341 guest collections**.
It covers 334 field, 333 array and 333 box owners with generated depths 1–5.
Its unchanged corpus hash is
`18c91f4e6fabf4b7f28afd8e760ff33a3438ac301e1174811241c029f431f140`.
The separately retained **96 source-route counterparts** are 32 specimens across
source, reloaded source and compiler-emitted CIL. Their counts are not included
in the 131,341 direct-CIL total. Every recorded positive case terminates with
instruction and collection counts equal.

The passing selection also includes negative and boundary controls for stress
modes, owner/root-provider modes, array continuation work units, observer pauses,
manual steps, stopped machines, and generator seed/bounds. Source bytecode cannot
create an unbox interior; box ownership is exercised by independent direct CIL.
This report does not establish native CLR, Rust or browser qualification.

The [manifest](manifest.json) hashes all three originals and preserves their
exact bytes. Archival inspection verified their supplied hashes, the recorded
Git tree, four generator hashes against that revision, 1,000 unique assembly
hashes and the per-case instruction/collection totals. No tests or benchmarks
were run during archival. This is an affected lifetime requalification, not a
full A05 or repository pass; overlapping historical corpus runs must not be added.
