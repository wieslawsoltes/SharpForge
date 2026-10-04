# Collector barriers

Production managed stores use the `HeapBarriers` facade. The facade performs the store, publishes the reference to generational/incremental collection, updates mutation revision once, and records the store observer event. Reference identity `{h,g}` remains stable when backing storage moves. Debugger `notifyWrite` remains a separate presentation event and does not insert another GC barrier or heap mutation revision.

## Store entry points

| Heap API | Barrier site | Publication |
| --- | --- | --- |
| `writeField(owner, index, value)` | field | Object/box/platform field, remembered edge and incremental insertion |
| `writeElement(owner, index, value)` | element | Validated array element, remembered edge and incremental insertion |
| `writeStatic(container, index, value)` | static | Static array/Map slot and root insertion |
| `writeRoot(container, index, value)` | root | Local/argument/evaluation stack, cache, temporary pin or other explicit root |
| `bulkCopy(destination, start, source, sourceStart, count)` | bulk-copy | One validated range publication after overlap-safe storage copy |
| `fillArray(destination, start, count, value)` | array-fill | One validated range publication after fill/clear |
| `replaceData(owner, data)` | bulk-copy | Transactional resize and one range publication after new storage is attached |

Primitive-only descriptors bypass reference validation/scanning. Mutable reference stores validate both handle and identity generation. String/frozen storage rejects mutation; zero-length ranges produce no phantom stores. Reference-capable range copy validates incoming identities before mutating the destination.

The spatial layer copies/fills contiguous arena ranges, avoiding per-element JavaScript write-barrier calls. The collector marks overlapping dirty cards as a range and scans reference slots only when incremental marking requires new edges. This does not remove the required linear cost of copying values or tracing live references.

## Source interpreter

| Bytecode path | Exactly one heap publication per scalar store |
| --- | --- |
| STLOC, incoming call parameters, evaluation stack/result publication | writeRoot |
| STSTATIC | writeStatic |
| STFLD | writeField |
| STELEM | writeElement |
| Exception/catch/unwind/return publication | writeRoot |
| Constructors and array initialization | Allocation inputs retained before reserve; default fills use fillArray; the result enters a stack root |

Dispatch handlers are registered in `execution/source-instructions.js`. The source VM delegates to that table; it does not maintain a second copy of store behavior.

## Direct CIL interpreter

| CIL reference-capable operation | Heap publication |
| --- | --- |
| starg, starg.s, stloc, stloc.s, stloc.0..3 | writeRoot through managed-address resolution |
| stsfld | writeStatic through managed-address resolution |
| stfld | writeField through managed-address resolution |
| stelem, stelem.ref | writeElement through managed-address resolution |
| stobj, stind.ref, stind.i | Destination-kind dispatch through managed-address resolution |
| cpobj for an executable scalar/reference representation | One destination-kind store after source read |
| initobj for an executable primitive/enum representation | One destination-kind store of the validated default |
| newarr / box | Allocation roots before collection; default fill/stack publication use the same APIs |

`execution/managed-address.js` resolves the destination once and dispatches exactly once by owner kind: local/argument, static, field/box or array. Readonly managed addresses reject writes. Interior byrefs retain their owner through root normalization.

The current CIL execution model does not expose general inline reference-bearing value-type blocks. Unsupported value-type initobj and managed-reference cpblk/initblk remain explicit execution/verification limits; a table entry is not a claim that unmodeled CLR layouts execute. Numeric indirect stores still pass through the validated storage boundary even when their values do not carry references.

## Platform and BCL producers

Platform existing-property stores call writeField; dynamic property addition and collection replacement call replaceData. All platform receiver/argument values remain rooted through invocation. Application/window/singleton/cache publication uses root barriers. Scheduler resume values, host completion values and debugger assignments use the same store entry points.

Array.Copy, Array.Fill, Array.Clear, Array.Reverse and Array.Sort publish ranges. Reverse/sort prepare their ordered result outside the live destination before bulkCopy. The extracted BCL collections use `legacy-storage.write` → writeElement; capacity growth/range mutations use heap-owned replacement and keep temporary storage rooted. Collection versions and platform property revisions remain distinct from collector metadata. StringBuilder chunk growth, Random state, numeric CopyTo/output arrays and debugger field/element edits use the heap facade.

`withRoots` scopes restore their starting pin depth. Any temporary retained across another allocation uses `pinRoot`, which also publishes through the root barrier. Initial object edges are explicit allocation inputs; no collector relies on inaccessible JavaScript call-stack locals.

## Independent tests

`tests/a06-barriers-store-proxy.test.js` installs test-only Proxy views over actual mutable `record.data` and observes new allocations through allocation-tick subscriptions. It detects indexed writes and record-data replacement, correlates scalar mutations with exactly one `onStore` event, and accepts explicit range events. Source and CIL fixtures exercise fields, arrays, ranges, extracted collections and platform properties. A raw direct write and an explicitly omitted element barrier are required negative controls. This instrumentation never inserts a barrier itself.

`gc/barrier-fuzzer.js` uses deterministic seeded schedules over all registered sites: field, element, static, root, bulk-copy and array-fill. Each site has an enabled control and an omission run. Publication occurs after mark termination while the target remains unswept, so a final root rescan cannot hide a missing root/static barrier. The immediate production verifier detects the invariant violation; an independent full-slot reachability trace then detects any reachable identity reclaimed by the actual collector.

`heap.barriers.disabledSites` and `onStore` are explicit, instance-owned test/diagnostic seams. Omission still performs the underlying store and observer event while suppressing collector publication. There is no import-time prototype patch. Tests restore observers and omission sets in finally blocks. Browser/native/Rust parity must be qualified separately from these JavaScript engine regressions.
