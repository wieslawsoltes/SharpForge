# Lexical exception control flow

`validateExceptionControlFlow(code, handlers, options?)` checks the EH region
tree, instruction placement, ordinary branch/switch targets, lexical fall-through
and `leave`/`leave.s` targets. It returns the same owned frozen tree as
`buildExceptionRegionTree`. Call it before executing untrusted method bodies.
Errors carry a stable `.code` and, for instruction failures, the exact source
`.offset`. The existing placement-only and ordinary-branch APIs remain separate.

The leave rules follow ECMA-335 I.12.4.2.8.2.8. A leave cannot exit a filter,
finally or fault, or enter a handler/filter from outside. Tries and catches have
different source restrictions: a catch can return to its associated try, and a
first-instruction try target is permitted when every enclosing target region also
permits entry. All enclosing source and target regions apply, including nested
handlers and coincident try starts. A leave within the same finally/filter/fault
is permitted by these lexical rules; that does not claim full verifiability.

The index precomputes nearest handlers/catches, the outermost enclosing try and
the innermost try excluding coincident starts. Associated catch families are
sorted once by try and byte offset. A leave uses binary membership lookups and
constant-time source checks plus a binary associated-catch search. For R regions,
I instructions and E explicit targets, total validation costs
O(R log R + (I + E) log(R + 1)) time and O(R + code bytes) index/bitmap storage,
in addition to existing decoded instructions. No recursion, ancestor walk or
temporary collection is allocated per leave. Shared decoding, prefix boundaries,
placement and branch checks run once per validation pass.

The region builder's lowerable hard limits and cancellation contract apply:
16 MiB code, one million instructions, 100,000 clauses and nesting depth 1,024.
An independent slow transcription checks every enclosing region in tests, across
all 179,200 source/target pairs in seven graphs. Additional cases cover 10,000
shared catches, deep nesting, exact diagnostics and retained native/Roslyn bodies.
The transcription is a specification comparison, not a native ILVerify oracle.

New diagnostics are CILCF0015 (leave exits a filter/finally/fault), 0016 (try source
restriction), 0017 (catch source restriction), 0018 (handler/filter entry) and
0019 (try-interior entry without an associated catch). CILR and CILCF0001–0014
retain their meanings.

This is a lexical pre-execution validator, not stack/type verification or a CFG
interpreter. Empty-stack requirements, prefix/opcode compatibility and metadata
resolution are separate. Automatic compiler/runtime activation and broad
browser/Rust/ILVerify qualification remain separate integration scopes. The scheduled local run passed all 51 focused EH tests, including the retained
reference corpus. No new native build was performed. Benchmark evidence and
reproduction instructions are in [benchmarks/EH-LEAVE.md](benchmarks/EH-LEAVE.md).
