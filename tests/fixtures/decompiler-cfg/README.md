# Decompiler control-flow graph — SF-A13-T07.1

The decompiler facade now runs decoded control-flow analysis before the existing
conservative C# lowering. Opcode reconstruction is extracted into readable handler
modules. The CFG reuses `verify/dataflow-blocks.js`; there is one block splitter.
Instruction decoding, prefix-group boundaries and exception geometry reuse their
existing CIL services. The pipeline reuses its already decoded method.

## Corpus and independent evidence

`input.mjs` contains manually reviewed expected block ranges, instruction ownership
and edge tuples for empty/return bodies, short/long/backward branches, loops,
duplicate and empty switch tables, unreachable Int64 instructions, prefix groups,
`jmp`, catch, filter, finally, fault and nested finally boundaries. Expected graphs
are authored separately from the implementation. All instructions, including
unreachable ones and prefix records, belong to exactly one block.

`Program.cs` captures CoreCLR's own IL bytes and exception-clause offsets for
Roslyn-built diamond, loop, switch, finally and nested filter/finally methods. It
also records observable filter/finally outcomes. The capture retains exact pinned
toolchain/environment data, source/image hashes, compiler command and raw process
results. The existing `eh-encoding/native.json` independently supplies SRM and
CoreCLR evidence for hand-authored filter and fault assemblies; the reference test
checks their image hashes before reusing their clauses. Native opcode flow facts
come from the existing complete Reflection.Emit descriptor capture.

CoreCLR's public reflection API supplies method bytes and EH facts rather than a
public basic-block graph. The exact graph oracle is the hand-checked tuple corpus;
the native comparison qualifies byte identity, boundary geometry, opcode flow
facts and eventual branch/switch/leave destinations. It does not claim equivalence
to an internal JIT CFG or infer dynamic exception dispatch.

## Scope

The immutable versioned snapshot contains only scalar records and arrays. Edges
are normal `branch`, `switch`, `fall-through` or `leave` edges. A leave edge records
its eventual IL target and `clearsStack: true`; intervening finally execution is
outside this graph. Exception clauses contribute all their start/end/filter
boundaries, but no guessed handler/finally dispatch edges. Dedicated region trees,
SSA, dominance, loop nesting and structured exception source remain separate
leaves #2548, #2549 and #2550. This batch does not widen the legacy C# reconstruction
families or their existing `complete` claims.

Malformed instructions/targets, invalid options, code/instruction/edge/clause
limits and cancellation have stable CILCFG diagnostics. Existing geometry/prefix
failures preserve CILR codes. Graph source failures retain complete IL with an
explicit diagnostic; an otherwise valid CFG stays accessible when C# lowering
falls back. Limits and cancellation propagate instead of being reported as source
reconstruction failures.

## Validation commands

Only the root agent runs capture and tests in the granted serial validation slot:

```sh
node scripts/limited.js node tests/fixtures/decompiler-cfg/capture.mjs tests/fixtures/decompiler-cfg/native.json
node scripts/limited.js node --test tests/a13-07-cfg.test.js tests/a13-07-cfg-reference.test.js tests/managed-il.test.js tests/a03-verifier-dataflow.test.js
```

`browser.mjs` exports `run()` for the existing browser module harness. It exercises
the graph corpus, diagnostics/limits/cancellation/ownership, pipeline behavior and
native reference replay through the browser JavaScript API. It does not execute
managed IL. Node/browser validation and new native capture are pending when this
implementation is handed off; the implementation agent ran no tests/builds or
benchmarks. Source VM/direct CIL/Rust native/Wasm execution coverage is not implied
by successful metadata analysis.

Graph splitting/projection uses O(I + E + C) time and storage; existing EH geometry
validation additionally sorts O(C log C) intervals and uses a bounded instruction
boundary bitmap. Input and output limits are independently documented in the CIL
README. No speedup or heap measurement is claimed.

Specification: [ECMA-335, sixth edition, I.12.4 and III.3.46](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
