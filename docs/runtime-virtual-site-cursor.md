# Virtual call site lookup candidate

This candidate retains the existing epoch-owned prepared-call and virtual-target
maps, and adds one last-site cursor to each cache. Repeated execution of the same
site skips the method WeakMap and offset Map lookups. Alternating sites use the
same indexed lookup and update the cursor without allocating an object per call.

The cursor compares the current method, instruction array, instruction offset
and operand. The virtual-target cursor also compares the resolved declaration
and closed owner. These are the existing map lookup keys. A changed code epoch,
inspector or heap MethodTable registry replaces the owning cache. A live cache
capacity change still validates the new capacity and creates an empty cache.

Live receiver lookup remains before every target-cache hit. The initialization
hook remains before that lookup and its epoch check, so a host callback can still
invalidate metadata between prepared-plan selection and target resolution.
Target verification, target shape checks, managed frame admission, normalization
hooks, instruction boundaries and cache statistics are unchanged. The cursor
retains metadata only and does not add managed roots or snapshot state.

The unchanged `virtual-cache` fixture at published
`312cd9242a492ce6f03e7e034a51cc17669a7edf` measured 2.206167153× with a 95%
confidence interval of [2.114787540, 2.299521094] over 100 paired samples. This
missed its required 3× target. The cursor is an unmeasured candidate following
that result; its implementation does not establish a speedup or close the target.

`tests/a05-inline-cache-cursor.test.js` covers alternating methods and sites,
receiver retirement, live declaration/owner/operand changes, capacity changes,
and invalidation inside the initialization hook. Existing inline-cache and
prepared-call suites cover cache isolation, restore, Hot Reload, receiver
ownership, megamorphic behavior, host hooks, quotas and instruction counts.
Syntax and diff checks passed during authoring. Execution of these tests and
paired qualification remain pending the serial validation slot.
