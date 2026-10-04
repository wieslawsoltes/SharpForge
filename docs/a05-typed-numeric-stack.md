# SF-A05-T08.1: typed numeric evaluation storage

`typedNumericStack:true` selects private Float64Array planes for the direct CIL
evaluation stack, locals and arguments. One byte per slot distinguishes Single,
Double and ordinary values. Proven floating constants, arithmetic, comparisons,
conversions, duplication and scalar stores access the planes without constructing
the existing frozen F wrapper on every instruction.

The exposed execution arrays remain writable Array proxies. Generic handlers,
managed pointers, debugger reads, GC enumeration and snapshot copies observe the
same immutable F values as before. Reads materialize a value once until its slot
changes. Snapshot data contains ordinary arrays, never controllers or functions;
restoring a frame reconstructs its private planes. Filter frames sharing locals
reuse one adapter. Frame pooling may call `releaseTypedNumericFrame` when retiring
a frame; replacing its arrays also invalidates the cached attachment.

Precise root scanners use `numericSlotRoot(array,index)` to read managed values
without materializing scalar slots. It returns undefined for raw numeric entries
and preserves ordinary array behavior for frames without numeric planes. Pools
clear slots through the proxy's length/set operations so tags, cached values and
managed references are released together.

Proven integer and floating local stores bypass managed-pointer construction only
when no write observer is installed. They preserve storage narrowing and the VM
write revision. Observed stores retain the existing notification implementation.
Pinned locals, managed pointers and nonnumeric stores retain their adapters.

T07 calls `ensureTypedNumericFrame(vm,frame,plan)` after obtaining its decode plan
and before executing an instruction. The decoder calls `specializeNumericHandlers`
before freezing handlers. With the flag absent, the existing stack representation
and non-plane specialization remain selected.

Prepared tests cover 10,000-iteration Single/Double loops without F materialization
inside the loop, signed zero, NaN, stack limits, write observers, shared locals and
snapshot reconstruction. These are structural allocation assertions, not a claim
about total JS allocations or throughput. Full heap-allocation tracing, floating
differentials and benchmarks remain deferred to the assembled E02 gate. Source
execution keeps its current scalar representation; this slice changes direct CIL.
