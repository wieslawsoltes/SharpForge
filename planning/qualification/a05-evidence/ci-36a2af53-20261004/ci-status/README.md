# Exact workflow status and preceding cancelled matrix

The push head `36a2af53287a563fd47d3a33b8e6e6382a726d35` has product tree
`da3add4a11cce5ed887d2a093eac4b48a4c26754`. Its PR merge
`edfa7cc8e11e05b9ceb0f6fdcb43fe071b24e11e` has the same tree and parents
`f009e2949f3311f0ca84a4a6bc694535140d130b` and the push head. The retained
Git commit and workflow/job responses preserve this distinction.

| Workflow | Event | Run | Final result |
| --- | --- | --- | --- |
| A05 native runtime qualification | push | 37229843614 | success, all eight jobs |
| A05 browser runtime qualification | push | 37229843622 | success, all three engines / eight cases each |
| Validate SharpForge | pull request | 37229845758 | failure in core Node tests |

The duplicate A05 pull-request qualification runs were skipped by the existing
owned-branch trigger policy. Their skips are not qualifications or failures.

Core job `111517027079` passed static/manifests, license and review checks, then
failed `npm test`. Its complete decoded GitHub job log is retained unchanged in
[core-job111517027079.log](core-job111517027079.log). A00 passed all 482 tests
with zero failures or skips. A01 then reported 809 tests: 805 passed, three failed
and one skipped. All three failures were in `tests/syntax-legacy-adapter.test.js`:

- The historical recorded-source corpus and repository-example deep comparisons
  found an additional `filter: null` member on ordinary catch nodes.
- The historical blanket unsupported list expected `struct S { int a; }` to fail,
  but source structs are now supported. The assertion stopped at that first case.

The core job failed normally, without a timeout. `core-platforms`, build and other
dependent qualification jobs were skipped; `ci-ok` failed. This archive preserves
that failed result rather than substituting later local repairs.

The preceding ca97 push has a separate incomplete native run, `37229435842`,
whose final result was cancelled. Exactly three jobs succeeded: Ubuntu SDK 8 and
both Windows x86 width jobs. Five jobs were cancelled: Ubuntu SDK 10, both standard
Windows cells and both macOS cells. These outcomes are retained in the original
workflow/job responses and are not combined into a complete ca97 matrix. Its
three browser jobs did complete successfully, with all eight cases per engine;
that evidence remains in the [ca97 archive](../../ci-ca97a540-20261004/README.md).

`manifest.json` hashes every status response and the decoded log. The source
GitHub log contained 1177487 UTF-16 code units, used LF, and ended in LF; those properties
are recorded alongside its SHA-256. No runtime or test program ran during archival.
