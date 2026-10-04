# Bounded CIL numeric blocks

The optional `specializeNumericHandlers` and `smallLongs` paths can execute a
bounded sequence of verified integer instructions directly against private frame
storage. This removes repeated Array proxy access and stack admission from the
interior of a block. The default interpreter and public Number/BigInt values are
unchanged. No generated JavaScript, dynamic evaluation or new dependencies are
used.

Decode builds the plan from the existing `verifiedStackBound` proof and bounded
`numericPlanTypes` analysis. A block accepts closed Int32 stack states, plus exact
tagged Int64 states when `smallLongs` is enabled. Constants, local and argument
loads/stores, supported arithmetic, comparisons, branches and a few stack
operations can participate. Calls, references, native integers, floating-point
values and unsupported instructions end the block. Existing arithmetic helpers
remain the authority for wrapping, overflow and division behavior.

Each original instruction still checks its current instruction identity, input
categories and private slot values before execution. An unsafe small-long result
leaves the operands untouched for the ordinary BigInt handler. Host replacement
arrays and custom descriptors disable private storage access. Code replacement,
option changes and explicit code invalidation use the existing decode-plan cache
rules. Restore creates fresh planes; the execution context reacquires them before
using a cached frame.

A block executes at most 64 instructions, stops at a branch, and respects the
remaining slice and global instruction budgets. It also stops before the next
existing 256-instruction clock check. Every executed instruction advances its own
PC, original IL offset and instruction count. Arithmetic faults consume the same
operands and report the same original offset as ordinary dispatch. Frame stack
and byte quotas are admitted before the block starts.

The ordinary interpreter retains all observer boundaries. Blocks are disabled
for debugger instruction callbacks, write and exception observers, profiling,
runtime events, instruction GC stress, enabled or suppressed scheduling, custom
instruction hooks, overridden VM stack/step methods, Wasm tiering and pending
managed continuations. Methods with exception handlers also retain ordinary
dispatch.

The `executionCodeStatistics` diagnostic includes `numericBlocks` and
`numericBlockInstructions` when work runs through this path. These are functional
coverage counters, not allocation or speed measurements. Public snapshots contain
the ordinary frame values, without plans, private execution contexts or functions.

`tests/a05-numeric-blocks.test.js` compares the original and optimized interpreter
across complete loops, slice boundaries, global quotas, arithmetic faults,
out-of-range Int64 fallback, observer hooks, custom descriptors and restore.
The unchanged paired qualification targets in `bench/vm/qualification-fixtures.js`
are the throughput authority. The required 2x Int32 and 3x small-long targets remain
pending until those measurements pass; this implementation alone makes no speedup
or zero-allocation claim.

A focused repeat can select one unchanged qualification target, for example:

```sh
node --expose-gc bench/vm/qualification.js --runner named-runner --native-bits 64 --suite targets --target scalar-slot-loads --samples 100 --out artifacts/slots.json
```

The report identifies the selected target in `targetScope` and its protocol.
Its decision applies only to that target; a selected run does not qualify the
other suite members. The target definition, baseline mode and threshold are the
same as in the complete suite.
