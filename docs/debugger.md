> **0.10 update:** [Advanced debugger and WinUI guide](advanced-debugging-winui.md) and [validation](validation-0.10.0.md) define the new symbol, async, live-editing and web-framework support; older limitations below describe the baseline unless explicitly superseded.

# SharpForge 0.9 debugger guide

This guide describes the implemented browser-managed source and direct-CIL debuggers. It does not describe a native CLR debugger or complete Visual Studio compatibility. See [validation](validation-0.9.0.md) for tested scope.

## Start, stop and understand the location

**F5 starts and runs to a breakpoint.** It no longer forces an entry pause. **F10/F11 from idle explicitly stop at entry**, then step over/into on subsequent presses. The Debugger / Exception Settings tool has an optional **Break on entry** preference. F5 continues, Ctrl+F5 runs without breakpoint stops/history, Shift+F5 stops, F6 requests cooperative pause, Shift+F11 steps out, Ctrl+F10 runs to the cursor, and Alt+F10 steps back through retained history. Reverse Continue is available through Debug and the command palette.

The stop banner tells you **why** execution stopped, the exact source/IL location, and whether the selected statement is **before execution** or **after a write/exception**. A normal source breakpoint pauses before the statement executes. A storage write breakpoint pauses after the value changes. The red breakpoint dot remains visible beside the yellow current-instruction arrow. Yellow is actual execution; selecting a caller adds a distinct blue inspection marker and does not move execution. **Show Next Statement** selects the executing frame and navigates back to it.

The reported CallStackLab screenshot showed `Paused – entry` on line 16 with a requested breakpoint on line 20. The old unconditional entry policy caused that stop. Version 0.9 also corrects independent binding/caller-location/resume bugs; it is not merely a change of status text.

### Reproduce the Fibonacci regression

Load **CallStackLab**, set a breakpoint on Program.cs line 20, and press F5. The first stop is line 20, before `Console.WriteLine`: `i` and `value` are 0 and buffered program output is empty. Continue visits that line ten times, with encounter counts 1 through 10, before termination. Repeated overlapping Continue requests are coalesced rather than skipping multiple stops.

## Source binding

Compiler sequence points carry UTF-16, one-based line/column positions and half-open statement spans. SourceBreakpointIndex indexes exact source identities, methods, and executable sites. A breakpoint on a continuation line binds to its containing statement; a blank/comment line binds forward within the containing method. A method's closing brace cannot silently bind into the next method. Newly compiled assemblies carry method source ranges in #SF. Older assemblies without those ranges have only the available source-map fallback; missing data is not invented.

A breakpoint records its requested location separately from its bound location and all applicable executable sites. Unbound entries show an explanation. Several statements on one physical line can share a line breakpoint; specify a **column** in its dialog to select a particular site. `breakpointLocations(uri, range)` enumerates available locations.

Source displayed for a debug session must match the embedded compiled text (line-ending normalization is accounted for). A mismatch is reported and the editor does not paint a misleading execution span. Source remains read-only while a debug snapshot is active, including Vim/Emacs modes. There is no Edit and Continue or Portable PDB support.

## Breakpoint manager

The docked Breakpoints tool manages source, function, storage-write and direct-IL instruction entries. Right-click a gutter/row or edit a row to configure the applicable rule. The tool displays requested/bound positions, verification, condition, encounter count, matching locations and enabled state.

- **When true** evaluates a bounded side-effect-free Boolean expression. **Has changed** establishes a value on first encounter, then qualifies when its value changes. Values are observed on every encounter, before the hit filter.
- Hit rules are `N`, `==N`, `>=N`, or `%N`. Counts mean enabled encounters, not only successful condition matches. Invalid rules are rejected/reported rather than treated as unconditional stops.
- Logpoints interpolate safe expressions and continue without a pause. `{{` and `}}` produce literal braces. **One-shot** disables the rule after a qualifying stop or log.
- **Mute All** preserves individual enabled flags and counts. Toggling enabled state preserves counts; changing a rule deliberately resets that rule's counter and changed-value baseline. Unchanged live replacement preserves identities.

Function breakpoints accept `Type.Method`, `Type::Method`, and supported signatures such as `MathBox.AddOne(int)`. They stop once per invocation, not whenever execution loops back to a first source point. With source mappings, the direct-CIL session waits until parameter-copy prologue instructions have executed so typed parameter conditions can be evaluated. Ordinary source-free CIL uses its first executable instruction and slot names such as `arg0`.

**Break on write** is available on supported Locals/heap rows. Both engines validate frame/allocation identity so a recycled handle cannot hit an old watchpoint. Source writes cover locals, statics, fields and array elements; direct CIL additionally covers supported argument/boxed storage. Only write access is supported. A caller assignment after a callee returns is attributed to the caller's store, not the callee's last source point. Resuming an after-write stop does not skip an as-yet-unvisited next source breakpoint.

## Stepping, callers and exception settings

Step over/out and run-to targets respect frame depth. Source **Step over properties** avoids accessor-only stops unless an explicit breakpoint requires a stop. Run to Cursor from idle compiles a fresh snapshot; from pause it uses the current assembly. Same-method temporary targets are pinned to the selected frame, so recursion cannot satisfy a caller's target accidentally. Another stop cancels the temporary target.

Exception settings support a global none/all/uncaught policy and per managed-type overrides such as `System.OverflowException`. Both spellings with/without the System prefix are accepted. Rules govern interpreter exceptions, not native process exceptions. A thrown exception can pause before handler unwinding. Continue consumes the pending fault once; reverse/forward replay preserves nested fault/finally continuations instead of sharing mutable fault objects with old snapshots. The C# profile currently has bounded catch/type semantics, not the full CLR exception hierarchy.

## Safe Immediate and watches

The docked **Immediate** tool evaluates supported side-effect-free expressions in the selected frame; Up/Down browses bounded input history. It shares the watch evaluator, not a second language runtime. Supported locals, primitive expressions, fields, arrays and known auto-property backing fields can be read. Computed getters, methods, assignments, increment/decrement and allocations are not evaluated. Results and stale-reference checks follow the selected pause/frame. Primitive variable edits remain explicit debugger operations.

## Reusable API

```js
import { compileToIL } from '@sharpforge/compiler';
import { DebugSession } from '@sharpforge/debugger';

const result = compileToIL('for(int i=0;i<3;i++) {\n Console.WriteLine(i);\n}');
if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
const session = new DebugSession(result.assembly, {
  recordHistory: true, maxHistory: 64, maxHistoryBytes: 8 * 1024 * 1024
});
session.setBreakpoints('Program.cs', [{ line: 2 }]);
session.setExceptionBreakpoints({
  mode: 'uncaught', rules: [{ name: 'OverflowException', mode: 'all' }]
});
session.start(false);             // reusable start() still explicitly defaults to entry
session.runUntilStop();           // use pump() for a cooperative interactive host
console.log(session.evaluate('i').result); // 0
session.resume('continue'); session.runUntilStop(); // i = 1
session.reverseContinue();       // returns to recorded i = 0 stop, restoring hit count
```

`CilDebugSession(bytes, {methodToken, arguments, recordHistory})` provides the same rule concepts over direct CIL. Use `instructionReference(methodToken, offset)` and `setInstructionBreakpoints` for exact instruction boundaries; `disassemble` returns actual bytes. `dataBreakpointInfo` returns session-bound storage IDs for `setDataBreakpoints`; never persist them as cross-launch identities. `SourceBreakpointIndex` and the source-remapping helpers remain separately reusable exports.

## Reverse execution boundaries

Source history defaults to **off in the reusable API**, and is explicitly enabled by Studio. Its default enabled bounds are 64 snapshots and 8 MiB estimated storage. Direct-CIL history likewise defaults off in its API, with enabled defaults of 128 snapshots and 8 MiB. Limits are adjustable within validated bounds; zero budgets retain nothing and oversized snapshots can be dropped.

Snapshots restore managed frames, locals, operand stacks, statics, heap, initialization state, exception/finally continuations, buffered output, instruction/write revisions, and breakpoint encounter/changed-value state. Reverse Continue returns to an actual retained stop, or the earliest retained state when no earlier stop remains. Changed rule configurations do not inherit a snapshot's obsolete condition seed. Same-VM ownership prevents restoring an unrelated snapshot, and frame/allocation identities never rewind into an old external descriptor.

This is **bounded managed-state replay**, not a native time-travel debugger, persistent trace, OS rewind or exact process-memory bound. It cannot retract already-delivered output callbacks or reverse external effects. The garbage collector remains non-generational nonmoving mark-and-sweep. Neither engine is a full CLR or independently audited security sandbox.

## DAP lifecycle

Initialize, launch, configure breakpoints, and then send **configurationDone**. Default launch runs to a breakpoint after that barrier; use `stopOnEntry:true` for an entry stop. The adapter negotiates one-/zero-based source coordinates, reports bound breakpoint changes and hitBreakpointIds, lists loadedSources/executable breakpoint locations, and exposes source/direct-IL data and reverse requests. Invalid/out-of-lifecycle requests and stale variable references fail explicitly. See [protocol guide](protocols.md).

No native CLR/process attach, PDBs, multiple native threads, async task stacks, function evaluation, Set Next Statement, Hot Reload, memory address editing, native watchpoint hardware or full Visual Studio/DAP parity is implemented. No external IDE integration or broad third-party DLL corpus was newly qualified.

## Examples and regression evidence

Five [debugger examples](../examples/features-0.9/README.md) cover multiline binding, caller writes, changed conditions, function signatures and exception/finally behavior; [DebuggerWorkshop](../examples/projects/DebuggerWorkshop/README.md) is a loadable .csproj/.slnx. Automated evidence includes 61 engine regressions, 12 DAP regressions, 12 real production-worker regressions, 31 new example checks, and 41 production-browser debugger checks. Full counts and reproduction commands are in [validation](validation-0.9.0.md).
