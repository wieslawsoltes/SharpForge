# Method headers and exact stack heights

`analyzeMaxStack(code, options)` computes the maximum evaluation-stack **height**
of the reachable instruction graph. It uses the canonical CIL opcode table,
prefix-group decoder, exception-region validation and bounded dataflow worklist.
It is not CLR type verification: a complete result can still contain unsafe or
type-invalid instructions, inaccessible members, or invalid method signatures.
Use the existing verifier for those independent checks.

```js
import { analyzeMaxStack, writeMethodBody } from '@sharpforge/cil';

const analysis = analyzeMaxStack(code, {
  handlers,
  resolveStackEffect(instruction) {
    // Return authoritative { pops, pushes } for call/callvirt/calli/newobj/ret.
    // The method signature, call-site signature and generic method parent must
    // come from the caller's metadata or bound-emission context.
    return effectsByFinalOpcodeOffset.get(instruction.opcodeOffset) ?? null;
  },
});
if (analysis.status !== 'complete') throw new Error(JSON.stringify(analysis.diagnostics));
const body = writeMethodBody(code, localToken, analysis.maxStack, handlers, {
  headerFormat: 'auto',
  initLocals: true,
  hasDynamicStackAllocation: analysis.hasDynamicStackAllocation,
});
```

The resolver is consulted only for variable effects. `fixedStackEffect(name)`
returns an immutable `{ pops, pushes }` from the same canonical opcode catalog,
or `null` for variable/unknown opcodes. Fixed effects cannot be overridden by the
resolver. Counts must be nonnegative safe integers; variable calls produce at
most one value, newobj produces one, and callvirt/calli consume at least their
receiver/function pointer. `ret` consumes zero or one value and produces none.
Missing variable effects produce `unknown`. Exceptions
thrown by the resolver propagate unchanged, including `CilError` instances.
Prefix-group `offset` denotes the first prefix; `opcodeOffset` denotes the final
opcode. Both are byte offsets in the supplied code, after branch relaxation.

Results contain `status`, `maxStack`, `diagnostics` and
`hasDynamicStackAllocation`. Only `complete` has a numeric maxstack and a boolean
allocation fact. `unknown`, `invalid`, `limited` and `cancelled` return `null` for
both facts. No observed partial peak is presented as an exact result. Unreachable
variable calls need no resolver, but malformed instructions, EH placement,
branch targets and trailing fall-through remain invalid even when unreachable.

Catch, filter and filtered-handler entries each receive an exception at height
one. Finally/fault handlers start at zero. The filter and filtered handler are
independent roots. Joins require equal heights; `leave` clears its outgoing stack
after its incoming peak is counted. The analyzer checks return/endfilter/
endfinally/jmp terminal heights and localloc's single-size-operand requirement.
Exception bounds retain the existing canonical clause shape and diagnostic IDs.

The default hard bounds are 16 MiB code, one million decoded instructions, 64
prefixes per group, 100,000 exception clauses, depth 1,024, four million graph
edges and 16 million worklist steps. Existing `maxCodeBytes`, `maxInstructions`,
`maxPrefixes`, `maxClauses`, `maxDepth`, `maxDataflowInstructions`,
`maxDataflowEdges`, `maxDataflowSteps` and `signal` options can lower these bounds.
Invalid bounds are input errors; exhausted bounds are `limited`. Cancellation is
observed through the existing decoder/EH/worklist boundaries. Complexity is
linear in decoded instructions and graph edges plus the bounded existing EH
index construction; memory is proportional to the decoded body and graph.

The canonical decoders preserve their existing error names, messages, offsets
and `.code` behavior. Exhausting the instruction-count or prefix-chain limit now
adds the stable field `error.limitKind` with value `instruction-count` or
`prefix-count`. Invalid options, malformed operands, dangling prefixes and
malformed switch tables do not receive a limit tag. Analyzer diagnostics retain
this tag and use `CILMS0006` when the underlying decoder has no diagnostic code.

## Encoding policy

`writeMethodBody(code, localToken, maxStack, handlers, options)` preserves the
historical encoding when `headerFormat` is omitted: a 12-byte fat header,
InitLocals set, and a minimum serialized maxstack of one. Existing `#SF`
canonical replay and callers using only EH options therefore retain their bytes.

Explicit `headerFormat` values are:

| Value | Behavior |
| --- | --- |
| `auto` | Choose tiny exactly when eligible; otherwise write a fat header. |
| `fat` | Write the exact supplied UInt16 maxstack, including zero. |
| `tiny` | Require tiny eligibility; reject a lossy encoding with `CILEH0001`. |

Tiny eligibility follows ECMA-335 II.25.4.2 and the native SRM body encoder:
fewer than 64 code bytes, maxstack at most eight, no local signature and no EH
sections. Tiny implies maxstack **eight**, independently of the computed smaller
peak. `initLocals` defaults to true and `hasDynamicStackAllocation` defaults to
false; the caller must supply the correct allocation fact. A body with dynamic
allocation and InitLocals requires fat encoding so initialization is preserved.
Setting both allocation=true and initLocals=false permits a tiny header when the
remaining criteria hold. These two options require explicit `headerFormat`.
The writer accepts opaque IL bytes; it does not independently validate their
stack effects or infer dynamic allocation.

EH section selection, alignment, cancellation, bounds and owned output bytes
remain governed by the existing EH encoder. A tiny body consists of its one-byte
header followed immediately by IL. The caller still controls placement/alignment
of the next body in the PE section.

References: [ECMA-335, sixth edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
[native MethodBodyStreamEncoder](https://source.dot.net/System.Reflection.Metadata/System/Reflection/Metadata/Ecma335/Encoding/MethodBodyStreamEncoder.cs.html).

## Direct compiler and remaining integration

The direct compiler retains eager emitter invariant checks but derives the
serialized bound from the completed relaxed instruction stream, including
inserted flag resets and hoisted-field rewrites. Its bound-emission context
supplies the existing authoritative variable effects by final opcode offset.
It opts into automatic headers, preserving initialization for localloc.
Reference-only emission keeps its existing throw-null contract and default body
writer; IL-document no-change assembly continues to preserve original bytes.

This is the additive core/direct-compiler portion of **SF-A03-T05.4 (#2391)**.
Legacy `emitter.js`, `emit/pe-options.js`, `loader.js` and replay orchestration
remain unchanged while active PRs #3766 (Project 18) and #3971 (Project 14) are
coordinated. Their default conservative bounds remain unchanged. Full #2391
closure requires that integration and qualification. Parent #50 still inherits
the unqualified, open #8 schema prerequisite; no planning claim or readiness
status is changed by this implementation.

Native preparation and qualification scope are described in
[the fixture README](../../tests/fixtures/a03-method-headers/README.md).
