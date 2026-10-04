# Integrated PDB writer and revision qualification

These are retained results for the combined reader/writer/revision candidate
`9cfd593809f85c197be89990bcceaa22bfd0f898` (tree
`7563f9d17ea67672fd392ae2e4dd79c925c62dfc`). The writer publication branch contains
the same writer source at `2e4d2f26e6f0700b55aaf5972c16018cdb0bf908`, but the
measurements were performed on the combined candidate, **not** on that writer
commit in isolation. Retaining this evidence changes documentation only.

## Distinct evidence

1. The original [512-byte writer fixture](../../written.pdb) and
   [SRM observations](../../reference.json) establish native SRM acceptance of
   that exact emitted minimal PDB on SDK 10.0.201/CoreCLR 10.0.5. The PDB hash is
   `8aa1d9b16d0dcad279fb9c63b416216f40ef367bdf30cf5ce456627bea64fae5`.
   This is distinct from the Roslyn-produced generation corpus.
2. The [pre-integration log](../pre-integration-node.tap) retains **48 passing
   tests**, zero failures/skips. Its exact checkout and Node version were not
   recorded. Its historical provenance remains unchanged.
3. [pdb-writer-revision-integrated.tap](pdb-writer-revision-integrated.tap) retains
   **56 passing tests**, zero failures, cancellations or skips, in the seven-file
   integrated gate at `9cfd59380`. The native tests in that gate replay retained
   SRM/Roslyn facts; this gate did not regenerate the native captures.
4. [pdb-existing-benchmark.json](pdb-existing-benchmark.json) compares the original
   ordinary emit/read/load workloads at baseline `8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c`
   and combined candidate `9cfd59380`. [pdb-generation-costs.json](pdb-generation-costs.json)
   measures new history/snapshot operations on the combined candidate, without a
   baseline speedup comparison.

The raw JSON results preserve every first, warmup and measured sample. The two
`.log` files are the original empty stderr streams, preserved as zero-byte files.
[provenance.json](provenance.json) records artifact sizes/hashes, invocation
provenance and source identities. [commands.md](commands.md) gives the recovered
arguments with filenames reconciled against the tested source, clearly labeled
as replay instructions because the original shell transcript was not retained.
The benchmark JSON itself records the complete
resolved package dependency source/manifest hashes, benchmark hashes, fixture
hashes, Git commit/tree and environment. No per-commit cause is inferred from
the combined-stack comparison.

## Results and limits

Each workload has 20 warmup rounds and 100 measured rounds, one operation per
sample, with alternating forward/reverse order. The extra first timed call follows
untimed correctness guards and is not process-cold. Only the operation is timed;
result checks, consumption, disposal and memory observation are outside timing.
The ordinary comparison requires byte-exact emitted PDB and attached image output,
matching read/load facts, source checksum/content, method identities and binding.
The new-cost run checks the retained native corpus and historical snapshot
ownership before timing. Both processes completed with exit code zero as recorded
by the execution coordinator; the raw JSON retains the successful guards.

Both runs used Node v24.19.0/V8 13.6.233.17-node.51 on Linux x64, kernel 6.18.44,
an AMD EPYC 9V74 host with nine visible logical CPUs, about 10.45 GB total memory,
and a 2,348,810,240-byte V8 heap limit. The exact environment and capture timestamps
are retained in each JSON. This is shared-host evidence, not an immutable isolated
runner claim. Reported heapUsed/ArrayBuffer changes include GC effects and are
not total allocations; no allocation improvement is claimed.

Ordinary emit/read/load p95 increased by **17.604531% / 21.756882% / 22.042318%**,
or **0.117052 / 0.057233 / 0.146115 ms**. These exceed the 5% budget. The
[automated review](automated-review.md) records the exact medians, new API costs,
shared-format correctness rationale and recommendation for an explicit PR
performance exception. It does not grant the exception, claim a threshold pass,
dismiss the measured tails as noise or assert human approval.

Browser execution has not run. The browser entry point replays captured native
facts through the JavaScript API; it does not execute managed updates. Native
active-frame binding, managed `ApplyUpdate`, Visual Studio integration and
Rust/Wasm runtime behavior remain unqualified. The new history/snapshot benchmark
does not measure delta writer emission cost. No additional tests, native captures,
benchmarks or builds were run while retaining these artifacts.
