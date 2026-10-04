# Decompiler pipeline and control-flow graphs

`@sharpforge/cil` provides conservative CIL-to-C# reconstruction and a separately
usable normal control-flow graph. These are JavaScript metadata/IL analysis APIs;
they do not load CLR types or execute managed code.

```js
import { readPE, buildControlFlowGraph, decompileMethod } from '@sharpforge/cil';

const pe = readPE(assemblyBytes, { inspection: true });
const body = pe.methodBody(methodToken);
const graph = buildControlFlowGraph(body.code, body.handlers, {
  maxInstructions: 100_000,
  maxEdges: 400_000,
  signal,
});

const result = decompileMethod(assemblyBytes, methodToken);
console.log(result.source);
console.log(result.controlFlowGraph);
```

## `buildControlFlowGraph(code, handlers = [], options = {})`

`code` is a `Uint8Array` containing one method's IL bytes. `handlers` uses the
existing method-body clause shape: `{ flags, start, end, target, handlerEnd,
catchType }`, with optional `filterOffset` for a filter clause. Offsets and range
ends are bytes relative to the method body; ends are exclusive. Flags are 0 for
catch, 1 for filter, 2 for finally and 4 for fault. Existing clause validation
checks flags, token/payload form, prefix-group boundaries and region geometry.

The returned snapshot is deeply frozen, contains only JSON scalar values and
arrays/records, and retains no code array, inspector or metadata objects. Its shape
is versioned as `format: 'sharpforge.control-flow-graph', version: 1, flow: 'normal'`.

| Field | Meaning |
| --- | --- |
| `codeSize`, `instructionCount` | Encoded byte length and number of decoded flat instructions, including prefix records |
| `entryBlock` | Block 0, or `null` for empty code |
| `blocks` | Physical-order `{ id, startOffset, endOffset, firstInstruction, instructionCount, successors, predecessors }` records |
| `edges` | Ordered `{ id, source, target, kind, caseIndex, clearsStack }` records; `source`/`target` are block IDs |
| `instructionBlocks` | One block ID for every instruction index, including unreachable instructions |
| `exceptionBoundaries` | Clause-order `{ clause, kind, tryStart, tryEnd, handlerStart, handlerEnd, filterStart }` byte offsets |

A block's `successors` and `predecessors` contain **edge IDs**. A switch retains a
separate `kind: 'switch'` edge and zero-based `caseIndex` for every case, including
duplicate destinations. Other edges have a null case index. Branch/switch edges
precede the corresponding fall-through edge; blocks and edges retain deterministic
physical order. Every decoded instruction belongs to exactly one block. Exception
boundaries are block boundaries or the exclusive method end.

The edge kinds are `branch`, `switch`, `fall-through` and `leave`. A `leave` edge
records its eventual IL destination and `clearsStack: true`. Intervening finally
execution, exception dispatch, filter acceptance and dynamic return from handlers
require region-aware analysis. `endfilter`, `endfinally`, `ret`, `throw`, `rethrow`
and `jmp` do not get a normal fall-through edge. The snapshot does not claim stack
verification, region-transfer legality, dominance or structured source recovery.

### Bounds and failures

All limits are optional, nonnegative safe integers and may only lower these
defaults/hard maxima:

| Option | Default and maximum |
| --- | ---: |
| `maxCodeBytes` | 16,777,216 |
| `maxInstructions` | 1,000,000 |
| `maxEdges` | 4,000,000 |
| `maxClauses` | 100,000 |
| `maxRegionDepth` | 1,024 |

Code and instruction bounds govern decoding. The code-byte bound also caps encoded
switch tables; the edge bound governs normal successor entries in the shared block
splitter. The clause bound is checked before traversing clause records. Block count
cannot exceed instruction count. `signal` accepts an AbortSignal or an object with
a boolean `aborted` property. Cancellation is checked before and after the existing
decoder and throughout graph/region work; large synchronous analyses belong in a
worker. Earlier PE/inspector construction retains its own existing limits.

`CilError.code` is stable: `CILCFG0001` denotes invalid input/options,
`CILCFG0002` an exceeded bound, `CILCFG0003` cancellation, `CILCFG0004` malformed
instructions, `CILCFG0005` an invalid branch/switch target, and `CILCFG0006` a normal
fall-through beyond the method. Instruction-related failures preserve `offset`.
Existing exception/prefix geometry failures retain the public `CILR` diagnostic
codes. `controlFlowGraphDiagnosticCatalog` exposes the CFG diagnostic messages.

Splitting/projection costs O(I + E + C); existing region geometry additionally
sorts O(C log C) intervals. Storage is O(I + E + C), plus the bounded code-size
bitmap used by existing prefix/region validation. These are logical algorithmic
bounds, not measured JavaScript heap ceilings.

## Decompile results

`decompileMethod(bytesOrInspector, methodToken, options)` reuses the inspected
method's existing decoded instructions for the CFG stage, then passes explicit
method/graph data to conservative opcode-handler lowering. It preserves the
existing token, name, language, complete, diagnostics and source fields and adds
`controlFlowGraph`. A method without an IL body has a null graph and the existing
`NO_IL_BODY` diagnostic. A source reconstruction fallback retains its valid graph
alongside the full method IL listing and `DECOMPILER_FALLBACK` reason. A graph
failure has a null graph and its stable diagnostic, severity and byte offset.

The same graph options apply to this stage. Inspector construction and initial
body decoding retain the inspector's bounds; they are not charged as new graph
work. Limits, invalid options and cancellation throw instead of being downgraded
to source fallback. `decompileAssembly(bytesOrInspector, options)` applies these
options per method, preserves whole-assembly source/count output, and propagates
such interruptions. Its returned method records include their graphs.

The supported source families remain the existing conservative subset. Generic
and pointer signatures, exception structuring, unsupported opcodes and nonempty
control-flow stack merges continue to produce explicit IL fallback. `complete`
describes that existing source reconstruction result; it is not new round-trip or
execution evidence. Region modeling, SSA and dominance remain separate project
leaves #2548, #2549 and #2550.

See the [focused corpus and reference protocol](../../tests/fixtures/decompiler-cfg/README.md)
for reviewed graph tuples, .NET IL/EH observations, browser replay and validation
commands.
