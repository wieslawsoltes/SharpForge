# Default managed stack admission

Project #7 issue [#1363](https://github.com/wieslawsoltes/SharpForge/issues/1363)
requires: “Recursion depth 10,000 on a small method succeeds by default; overflow
terminates with fatal state and cannot be caught by catch(Exception).”

Source, reloaded-source and direct CIL VMs now default to **4 MiB
(`maxStackBytes: 4_194_304`) of logical managed stack storage**. They have no
implicit frame-count ceiling (`maxFrames: Infinity`). An explicit `maxFrames`
option remains an independent limit; for example, `maxFrames: 512` retains that
host's chosen depth bound. This replaces the former default of 512 frames rather
than raising it to a different arbitrary count.

The existing byte accounting charges a 16-byte frame header, metadata-sized
arguments and locals rounded to eight-byte slots, and reserved evaluation-stack
capacity. Source arguments are already local slots and are charged once. CIL
uses its admitted verified capacity (including reserved space in the CLI header); replaced or unverified code keeps checked
fallback capacity. Aggregate values use their closed layouts. These are logical
runtime bytes, not a claim about JavaScript heap, RSS, or a native CLR stack.

Runtime-only argument carriers use their existing canonical logical widths:
`ArgIterator` reserves 24 bytes, `RuntimeArgumentHandle` 8 and `TypedReference`
16. Both engines charge those records without granting a physical CLI layout,
raw `sizeof`, boxing or unrelated struct-storage capability. Exact-fit and
one-byte-short tests cover both ABIs and snapshot preflight.

Optional vararg storage is charged from the closed call-site type of each packet
entry before allocating its callee. Decimal and multi-slot aggregates retain
their complete existing declared storage charge; an optional byref charges the
pointer slot rather than its referent. Live quota changes, filter frames and
snapshot preflight use the same packet metadata. Optional arguments do not
silently fall back to one eight-byte slot when their value needs more storage.

One VM-wide budget includes active, parked and temporarily retained callback
frames. Admission reserves before allocation, rolls back failed construction,
and releases on return, unwind and stop. Pool retention has its own independent
budget. Snapshots preflight their complete captured stack before mutation and
reconstruct the live charge after restore. Existing instruction limits, root
visitation, address lifetimes, cancellation and debugger fault inspection remain
in force. Stack overflow is a fatal runtime fault and bypasses guest handlers.

Hosts can set a different finite `maxStackBytes` value of at least 16 bytes;
invalid values reject. Omitting it, including an explicitly undefined constructor
value, selects the default. Existing host-side live-option control remains: a
host can lower/change the limit or deliberately delete it to disable byte
accounting. Guest code cannot change these host options. An explicit depth limit
continues to apply independently.

Host replacement or length growth of local/parameter metadata invalidates cached
storage charges before the next call or live-frame instruction. Same-length
in-place type/body edits retain the existing explicit code-invalidation contract;
they must not be used to keep old verification or layout authority.

This policy follows CONTRIBUTING's requirement that untrusted execution have
explicit resource limits. The shared default is applied before source proof or
CIL admission. It reuses the existing accounting implementation; it does not add
another stack walk or allocation on each instruction. Enabling existing byte
accounting by default can affect timing, so prior performance observations do
not qualify this new policy.

`tests/a05-default-stack-budget.test.js` adds exact 10,000-recursive-call execution
with entry frames, collection at maximum depth, fatal default-byte overflow,
explicit 512-frame rejection, deep reference roots, snapshot replay and stop
followed by fresh admission for all three routes. Both source fusion settings are
covered. The existing stack-byte suites cover exact charge boundaries, parked
contexts, callback reservations, host quota changes and aggregate widths.

All 13 default-policy cases passed in the integration coordinator's 112-test run
at `c47260dfe`, including the exact 10,000-call tests on all three routes. The
later `a05-stack-metadata-growth` regressions for cached length changes await their
serial slot. Native/browser and final performance results remain separate
qualification.
