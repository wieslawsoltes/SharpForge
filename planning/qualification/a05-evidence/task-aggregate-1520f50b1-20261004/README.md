# Task AggregateException construction regression — 2026-10-04

At merge `1520f50b1d2b8a890e45e5da3186577964468c9a` (tree
`4d947f761d87122ed58ca4e3abc4a6159c5ad8e1`), the focused three-test file passes
**3/3 with zero failures or skips**. It exercises actual CIL Delay boundaries,
Task.Wait/Result aggregation versus await identity, and mixed waiter fault modes.
The aggregate check also reads InnerExceptions.Count and [0], flattens the aggregate,
and verifies original exception identity while collecting at every managed allocation.

The deliberately dirty control replaces only `scheduler-task-delivery.js` with the
preserved pre-fix blob. It fails **one of three tests** with NullReferenceException
when reading the missing inner-exception list. The other two tests pass. The initial
raw default-reporter observation and a subsequent explicit TAP capture are both
retained; neither failed observation is presented as a pass.

The fix uses the canonical exception and AggregateException constructors. Input
references remain rooted throughout construction, including allocation observers.
After the control run, the product file was restored byte-identical to the tested
merge before the passing run. No native execution, broad-suite result, performance
result, or later-revision pass is implied.

`manifest.json` records exact commands, limits (one run, one test worker, 512 MiB),
owned package links, test outcomes, product identity, and payload hashes. All raw
outputs are retained without rewriting.
