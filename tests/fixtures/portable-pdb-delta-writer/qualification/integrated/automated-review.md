# Automated source and performance review

Reviewed combined candidate `9cfd593809f85c197be89990bcceaa22bfd0f898` against
baseline `8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c`. This was a read-only automated
review of the ordinary emit/read/load source delta, writer/revision bounds and
ownership, benchmark drivers, and retained raw results. It did not run product
code, tests or benchmarks. The reported medians and p95 values were independently
recomputed from all 600 ordinary-path and 500 new-API measured samples and matched
the retained summaries exactly.

## Finding and recommendation

No blocking product defect or concrete avoidable traversal was found in the
ordinary emit/read/load paths. Publication is recommended with an **explicit
performance exception** for the measured p95 regressions. This review does not
provide that acceptance or claim human approval; acceptance must be recorded in
the PR. The measurements exceed the 5% regression budget. They must not be
described as a threshold pass or dismissed as noise.

| Ordinary operation | Median baseline/current, ms | Median change | p95 baseline/current, ms | p95 change | Absolute p95 increase, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Emit | 0.4332615 / 0.4215845 | -2.695139% | 0.664897 / 0.781949 | **+17.604531%** | **0.117052** |
| Read | 0.147141 / 0.148178 | +0.704766% | 0.263057 / 0.320290 | **+21.756882%** | **0.057233** |
| Load | 0.3940345 / 0.3939695 | -0.016496% | 0.662884 / 0.808999 | **+22.042318%** | **0.146115** |

The concrete format/correctness rationale is:

- One shared serializer and metadata column-width service handle ordinary PDBs
  and minimal deltas, including wide references and `#JTD`, without maintaining a
  second metadata writer. Ordinary serialization retains the same data passes;
  it does not invoke delta round-trip validation.
- The reader distinguishes standalone admission from explicit delta projection.
  Ordinary reads reject minimal deltas and skip the delta remapping and its extra
  row-budget pass.
- The DEFLATE adapter gives known malformed input stable symbol diagnostics while
  preserving unexpected implementation errors.
- Ordinary emit/read/load does not construct generation histories, revision
  caches or snapshots. Their ownership costs belong to the separately measured
  new APIs.

The review supports the shared-format design; it does **not** establish how much
each change caused the observed tails. The measured candidate includes the
integrated reader, writer, revision adapter and other identified package source
differences. These are combined-stack results, not per-commit attribution. The
ordinary fixture is one 9,800-byte embedded source document with three empty
method point maps; it does not establish a broad scaling guarantee.

## Bounds and ownership

Writer byte/source/record/point limits bound its admitted input, canonical method
ordering and output. Its final read-back validation runs only in the explicit
delta API. The generation provider has byte, metadata-record and generation
limits, validates envelope identity before appending, and preserves earlier
method revisions.

The revision map checks point/document budgets before retaining a new private
map, shares that map across leases, and excludes embedded source from captured
document metadata. Public record queries return owned copies. Cancellation is
checked before capture admission and before committing the lease. The last lease
releases the cached map; retained snapshots remain independent of later updates
and provider disposal. No full-history scan, duplicated embedded-source copy per
cached lease, or eager snapshot work was found on the ordinary path.

| New operation | Median / p95, ms |
| --- | ---: |
| Read baseline and append both deltas | 0.385256 / 0.722502 |
| First capture with a new map | 0.019734 / 0.046548 |
| Capture with an existing cache lease | 0.0044565 / 0.009504 |
| Historical location query | 0.001287 / 0.003014 |
| Snapshot location query | 0.000490 / 0.001552 |

These are new API costs, without a baseline speedup comparison. Observed
heapUsed/ArrayBuffer deltas are retained in the raw results; garbage collection
affects them and they are **not total allocation counters**. The shared-host
environment, one-process paired comparison and first-call limitations remain
part of the evidence. No browser, live ApplyUpdate, native active-frame binding,
Visual Studio, or Rust/Wasm runtime qualification follows from this review.
