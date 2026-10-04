# Explicit CIL branch layout

`CilWriter.finishWithLayout({ maxInstructions, signal })` returns `{ code, offsetMap }`.
It resolves the writer's symbolic labels, selects short branch forms when their
signed displacement fits, and widens requested short branches when needed. Numeric
branch and switch targets are relocated as well. Non-branch instruction encodings
are copied unchanged. Compact local/integer selection remains the writer's separate
opt-in helper option.

`offsetMap` is a caller-owned Map from each original instruction boundary to its
final boundary, including original code length to final code length. Neither the
input writer, its labels, fixups nor recorded offsets are changed. Repeated calls
produce independent code/maps. Ordinary `finish()` keeps its prior contract,
including rejecting an out-of-range explicitly requested short branch. Nothing
automatically switches compiler emission, canonical replay, EH or debug maps to
the new API. Consumers must explicitly map their own offset-bearing data.

Targets must be actual decoded instruction starts. Missing labels, interior targets,
branches to the end boundary, malformed instruction bytes and inconsistent fixups
produce CilError. Prefix-group legality, stack validity and exception-region
transfers are verifier responsibilities; this API does not claim those checks.

Layout begins with all short-capable branches short. Each branch can widen exactly
once, by three bytes. Prefix sums use a Fenwick index with O(log n) updates/queries.
After a widening, only sources within 128 instruction indices on either side can
be affected while still short: each instruction occupies at least one byte, and a
short displacement spans at most 128 bytes. At most 257 candidates are examined
per widening. Work is O(n log n + switch targets), memory O(n + switch targets),
with the fixed 257-neighbor factor independent of method size. Widths only grow,
so the resulting fixed point preserves every branch that can remain short for
the fixed non-branch encodings.

The input limit is 16 MiB, with at most one million instructions, labels, fixups
and aggregate switch targets. `maxInstructions` can lower the instruction limit
to zero. Invalid budgets are rejected. Cancellation is checked before decoding,
between phases and during layout/emission. Decoding and target resolution are
synchronous bounded phases. There is no cache or retained global method state.

Focused edge cases, deterministic mixed graphs, a four-method native execution
fixture, and bounded decode/layout measurements are prepared. Validation is pending
the serial slot. Broader compiler/EH/debug integration and A00 qualification remain
open under #2389; this is the explicit layout capability increment.
