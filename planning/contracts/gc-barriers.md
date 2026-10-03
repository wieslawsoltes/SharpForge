# Collector barriers

Today's precise non-moving full-heap mark/sweep needs no remembered-set or relocation barrier. All writes must still update debugging mutation revisions. A future collector must implement these signatures in JS and equivalent Rust traits before enabling movement/generations:

- `storeField(owner, index, oldValue, newValue)`
- `storeElement(owner, index, oldValue, newValue)`
- `bulkCopy(destination, start, oldValues, newValues)` (including overlap, initialization and clear)
- `storeStatic(module, index, oldValue, newValue)`
- `storeRoot(frame, kind, index, oldValue, newValue)` for locals/args/stack ownership
- `storeAddress(address, oldValue, newValue)` dispatches exactly once by address owner/kind to the relevant hook.
- `readReference(owner, slot, reference)` returns the relocated reference when movement is enabled; identity remains unchanged.

| Bytecode reference store | Exactly one hook |
| --- | --- |
| STLOC | storeRoot |
| STSTATIC | storeStatic |
| STFLD | storeField |
| STELEM | storeElement |

| CIL reference-capable store | Exactly one hook |
| --- | --- |
| starg, starg.s, stloc, stloc.s, stloc.0..3 | storeRoot |
| stsfld | storeStatic |
| stfld | storeField |
| stelem, stelem.ref | storeElement |
| stobj, stind.ref, stind.i | storeAddress |
| cpobj | bulkCopy (destination kind determines owner) |
| initobj | bulkCopy (zero/default references) |
| cpblk, initblk | bulkCopy; managed-reference use requires verification and is currently unsupported |

Numeric stelem/stind forms are not reference stores. NEWOBJ/NEWARR/box create unpublished objects, whose initial outgoing edges are allocation roots; publication into locals/fields uses the listed hooks. Builtins such as Array.Copy/Fill/Clear/Reverse/Sort and platform property stores must invoke bulkCopy/storeField, even though they have no standalone store opcode. Filter/function-pointer/pointer mutation execution is not implied by this table. The table is a future collector contract, not a claim that hooks are already in production dispatchers.
