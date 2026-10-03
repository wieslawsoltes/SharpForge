# CIL token resolution caches

This SF-A05-T07.3 slice builds on the decode-plan code epoch. Direct CIL calls,
delegate method pointers and runtime token loads share immutable metadata
descriptors by token. Repeated instruction sites therefore reuse descriptors;
different sites referring to the same token also share them. Verification
membership uses a Set instead of scanning `report.methods` on every dispatch.
Replacing the report's method list rebuilds that Set.

Existing caches remain authoritative: `AssemblyInspector.getMethod` owns decoded
method bodies, `CilTypeSystem.layout` owns layouts, and `FieldResolutionCache`
owns field signatures and indexes. Field metadata now belongs to the same code
epoch as token descriptors. Instance fields use their receiver MethodTable as the
substitution key; static fields use the complete closed owner name, including the
owner carried by a managed static address. Thread-static context IDs and physical
slots are selected on every access, separately from cached metadata. No receiver,
heap record, static value or managed handle is retained in these caches.

`ldstr` caches decoded UTF-16 text and still passes through `StringInternPool` for
managed identity. Weak interning, collection and restore can replace heap handles
without making the text cache stale. Runtime type names are metadata-only strings;
MethodTable identity remains local to the VM. Raw method descriptors retain their
generic variables rather than caching caller-substituted results. This slice does
not extend the supported generic-call profile.

Successful restore, stop and `invalidateExecutionCode` discard token and field
caches together with decode plans. Inspector or MethodTable registry replacement
changes the epoch automatically; committed Hot Reload replaces the inspector.
Rejected restores and rejected Hot Reload changes preserve cache identity. In-place
code edits require explicit invalidation; metadata schema changes require a new
inspector/type system. Snapshots contain no token-cache maps or handler functions.

`tests/a05-token-cache.test.js` prepares ordinary CIL field/call/string loops with
an inspector resolution counter, closed generic storage isolation, invalid and
collected receivers, independent VMs sharing one inspector, weak string interning,
snapshot restore and debugger Hot Reload. The warm-loop assertion requires zero
additional `resolveToken` calls with decode plans both enabled and disabled.
These are prepared regressions, not measured performance evidence.

Serial validation at `21cc0fee` passed all 106 tests in the command below under
Node 24.21.0, one worker and a 512 MB heap cap. This revision includes the merged
decode-plan and virtual-slot changes. Static/manifests and build validation use
the required core check; benchmarks and broad qualification remain staged:

```sh
node scripts/limited.js node --test tests/a05-token-cache.test.js tests/a05-decode-plan.test.js tests/a05-delegate-targets.test.js tests/a05-statics.test.js tests/a05-tokens.test.js tests/a05-t01-small-storage.test.js tests/a05-cil-method-events.test.js
```

Source dispatch is unchanged. Native, browser and platform qualification,
profiling evidence and complete T07 acceptance remain open; no speedup or
allocation-free execution claim is made.
