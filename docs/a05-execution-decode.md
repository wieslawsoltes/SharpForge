# CIL decode plans and code epochs

`getDecodePlan(vm, method)` derives opcode IDs, operand-pool indexes and branch PCs once per closed
method instance and VM code generation. The opcode values come from `CilOpcodes`. Int64 and floating
operands remain exact entries in `operandValues`; the Int32 operand array contains indexes, not narrowed
values. Switch targets have their own instruction-index arrays. Existing instruction objects remain the
debugger and exception-location identity. Offset maps are shared with frame construction.

The CIL step dispatch indexes a frozen handler array. It does not look up an opcode name in the handler
Map. Numeric specialization contributes verified handlers before that array is frozen. The private cache
has a last-method fast path; switching methods uses a token-indexed map of weak method identities so
different closed generic instantiations retain different numeric facts.
The optional typed-numeric frame adapter runs after plan lookup and before the program counter advances;
changing either numeric execution option rebuilds the method's plan.

Nonempty native typed arrays cannot be frozen in JavaScript. The plan keeps canonical arrays private and
returns independent Int32Array copies when `opcodeIds`, `operands`, `branchTargets` or `switchTargets`
are inspected. The execution loop does not read those copying accessors. Original instruction objects and
the existing offset Map remain code-owner metadata; code changes must replace the owner or invalidate it.

The runtime exports `invalidateExecutionCode(vm, reason = 'explicit')`, returning the new numeric epoch,
and `executionCodeStatistics(vm)`, returning frozen cold-decode counters and elapsed milliseconds.
Inspector/image replacement advances the epoch automatically. Successful debugger Hot Reload and VM
stop explicitly invalidate it. Rejected edits leave it unchanged. Derived caches never enter VM/frame
snapshot fields; a fresh VM reconstructs them after portable restore. No host callbacks enter snapshots.

Qualification is deferred until the complete E02 integration is ready. `tests/a05-decode-plan.test.js`
prepares exact operand, warm-allocation, owner replacement, Hot Reload and portable restore cases.
`node scripts/benchmarks/a05-decode.mjs [output.json]` prepares cold-decode and warm-dispatch evidence.
No speedup or completed cross-platform qualification is claimed.

`token-cache.js` caches raw tokens, user-string text, type names and resolved method/field descriptors.
Closed caller methods and receiver MethodTables are separate substitution keys. Field entries contain
the immutable descriptor and slot index, never a managed receiver or heap record. Every field access
checks the current reference and reads its current storage, including after GC or snapshot restore.
Verified method membership uses an epoch-owned Set. A replaced MethodTable registry also invalidates
derived code state. The metadata-only field cache follows the design from PR #2804; its independent
field-assembly fixture is reused for closed generics, reused tokens and restored storage.
`tests/a05-token-cache.test.js` prepares warm-path zero-resolution and invalid receiver cases; execution
and performance measurements remain deferred.

`inline-cache.js` caches call-site targets by exact receiver MethodTable, concrete caller and instruction
offset. One receiver takes the monomorphic path; up to four distinct bindings are retained by default
(`inlineCacheSize`, range 1–16). Another binding permanently selects the megamorphic dispatch fallback
for that epoch. `inlineCaches:false` selects uncached resolution. Receivers are always validated before
looking up a cached target; metadata entries cannot keep objects alive. Interface/default/explicit slots
still use the existing dispatch implementation on a miss. Code-owner and registry changes drop every site.
The deferred `a05-inline-cache.mjs` benchmark records raw cached/uncached virtual and interface timings
and fails its evidence result if the issue's 3× median threshold is unmet. That threshold has not been measured.

Source fusion uses the same private code epoch. It prebinds local/local/binary, local/constant/binary/store,
and comparison/conditional-branch groups without crossing a sequence point or an incoming branch. Protected
methods keep ordinary dispatch. Every original instruction retains its budget charge and precise fault PC;
the first operand remains visible when loading the second faults. Groups stop before the existing 256-work
time check and never exceed the remaining slice or global instruction budget. Local stores retain value-copy,
boxing and write-revision semantics. No executable plan enters snapshots.

`sourceFusion:false`, a sequence callback, write/exception observer, instruction GC stress, profiling or an
armed scheduler selects ordinary dispatch. Inactive scheduler instruction hooks are skipped; activation during
an ordinary instruction is observed before its after-instruction hook. `executionCodeStatistics` additionally
reports `sourcePlans`, `sourcePlanMilliseconds` and started `sourceFusionGroups` for the current epoch.
`tests/a05-source-fusion.test.js` prepares slice/fault/observer/restore parity cases. The deferred
`node scripts/benchmarks/a05-source-fusion.mjs [output.json]` records cold and warm source/reloaded Fibonacci
and loop measurements, requiring the issue's 1.5× median target. Measurements remain pending; this is not a
performance claim.
