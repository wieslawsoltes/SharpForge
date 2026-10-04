# Explicit instruction prefix groups

`decodeInstructionGroups(bytes, options)` returns one record per target instruction.
Each record retains name, operand and operandKind; its offset is the first prefix
or the target's offset, opcodeOffset is the target opcode byte position, size spans
the entire group, and prefixes contains the ordered decoded prefix records.
Branch and switch operands remain absolute byte offsets, as in decodeInstructions.
The existing flat decoder is unchanged and remains the default consumer API.

Grouping validates unaligned operands 1/2/4, no. flags 0–7, and non-nil TypeDef,
TypeRef or TypeSpec token encodings for constrained. Operand-free prefixes reject
extra operands when written. Dangling chains and branches into a later prefix or
the target opcode are rejected with the offending byte offset. Targets must be
the start of a whole group. Unknown/truncated encodings use existing decoder errors.

`writer.group(name, operand, prefixes)` emits a group through the existing opcode
writer after validating its prefix list. Prefix entries are `{name, operand}`;
extra decoded location fields are ignored. The target cannot itself be a prefix.
The target operand follows `op(...)` semantics, including relative numeric branch
displacements and symbolic labels; it is not automatically converted from a decoded
absolute offset. `finishWithLayout` remains the explicit relocation operation.

Limits are 16 MiB input, one million decoded instructions and aggregate switch
targets, and 64 prefixes per group. `maxInstructions` and `maxPrefixes` can lower
those limits to zero. `signal` supports pre-cancellation and checks during grouping
and target validation; raw decoding is a synchronous bounded phase. Group records
and prefix arrays are caller-owned; input bytes and writer output do not alias them.

This is a structural binary API. It preserves order and repeated prefixes without
claiming full opcode-specific prefix legality, tail-call safety, constrained type
resolution, verifier acceptance or execution support. The no. encoding remains
ECMA-only where the runtime does not implement it. Those checks remain verifier
work under #2390/#52, and no existing VM is switched to grouped instruction records.
[Memory-prefix validation](PREFIX-MEMORY.md) is an explicit additional API for
volatile/unaligned/no. targets and strict duplicate checking.

Validation: all five prefix tests and 205 branch-layout/compact/opcode/CIL tests
pass. SDK 10.0.201 / .NET 10.0.5 on macOS ARM64 captures and executes a legal
volatile/unaligned/volatile indirect load, returning 42; the native bytes round-trip
exactly. Native build has zero warnings/errors. Required check passes (2462 syntax /
2458 static modules, zero errors), with no structure findings in this increment's
files. The observation qualifies this chain only; broader A00/platform work stays
open. Existing opcode writer and flat-decoder hot loops are unchanged.
