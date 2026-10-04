# Reference-slot liveness

`SF-A05-T09.2` adds optional last-use pruning to the existing root visitor. Enable
it with `preciseRootLiveness: true` in source or direct-CIL VM options. The default
continues retaining reference locals for host/debugger inspection. Setting
`preciseRoots: false` also disables liveness pruning and preserves the iterable
root-provider path.

| Capability | Source / reloaded source | Direct CIL |
| --- | --- | --- |
| Canonical dead reference locals | Supported with exact source proof | Supported with exact CIL proof |
| Declared reference arguments | Stored in source locals | Separate argument slots |
| Captured byrefs and parked stacks | Conservatively retained | Conservatively retained |
| EH / filter / unfamiliar control flow | Conservatively retained | Conservatively retained |
| Evaluation stack pruning | Not enabled | Not enabled |

Run `node examples/runtime/reference-slot-liveness.mjs` for a small complete
example that collects a last-used object while its method is still executing.

## Proof and collection boundaries

The analysis uses the existing source or CIL verifier's proof of the exact method
body. A source image without reusable bounds is verified once with bounds enabled.
Each collection rechecks a method's body proof once, regardless of the number of
recursive invocations. In-place body edits invalidate pruning; changed signatures
or local metadata invalidate the slot plan. Plans are private, belong to the VM's
code generation and are absent from snapshots.

Backward may-liveness follows ordinary fallthrough, branches, switch edges,
overwrites and loop backedges. CIL `ldarga`/`ldloca` slots remain live for the whole
frame lifetime, as do implicit arguments forwarded by `jmp`. Source opcodes must
be explicitly understood by the analysis. Unrecognized or unsupported control
flow uses conservative roots.

At collection, a reference slot is cleared only if it is dead at both the current
and previous instruction inputs. This keeps operands safe when allocation happens
inside an instruction whose PC has already advanced, without adding tracking to
the interpreter's hot loop. Only canonical handles issued by this VM's heap in
declared reference slots qualify. Scalar slots containing host-inserted handles,
copied/malformed handles, structs, spans, byrefs, pointers and unknown types retain
the existing conservative behavior.

Clearing a dead handle before tracing prevents a later snapshot from retaining an
unrooted stale local. Debugger-paused or faulted execution does not prune. Parked
contexts, filters, methods with EH regions and pending delegate/event/array/unwind
continuations remain conservative. Evaluation stacks are always scanned in full.

## Captured and suspended references

Addresses created dynamically through the managed-address API record the captured
argument/local in `frame.rootCaptures`. This includes host-created addresses that
have no corresponding address-taking instruction in the bytecode. The small sets
are part of captured frame state and survive restore. Normal frame retirement
invalidates the address; pool clearing removes the capture sets before reuse.

The root inventory includes filter faults, exception-event handlers and arguments,
multicast delegate targets and arguments, async-builder tasks, awaited state-machine
tasks, managed-array operation owners and synchronization owners. Their root
visibility is independent of local liveness. Strong host handles continue retaining
their values even when an unrelated dead local is pruned.

## Bounds and validation

Analysis is capped at 65,536 instructions, 4,096 slots, 1,048,576 bitmap words and
1,048,576 CFG edges per method, with a 16,777,216 operation work budget. Cached
plans and their slot/type inventories share an 8 MiB logical per-generation budget.
Exceeding a bound retains conservative roots; it does not reject an otherwise
valid program. These are logical allocation bounds, not JavaScript RSS estimates.

```sh
node scripts/limited.js node --test tests/a05-reference-slot-liveness.test.js tests/a05-continuation-root-inventory.test.js
```

Focused cases cover source and direct CIL last-use collection, source-assembly
reload equivalence, aliases captured by host byrefs, snapshot replay, parked and
paused frames, body/type edits, loop and switch control flow, address escape,
`jmp`, malformed input and analysis bounds. The existing conservative root visitor
tests remain unchanged. Fresh serial qualification is pending; no 3x root-scan
speedup or native/browser/Rust qualification is claimed by this implementation.
