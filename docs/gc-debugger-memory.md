# Pinned debugger memory

`DebugSession` and `CilDebugSession` expose the same bounded byte-memory API.
Source images, canonical reloaded assemblies, and independently authored supported
CIL use the heap's existing counted pins, virtual address space, and spatial payload
storage. The debugger does not expose JavaScript, native-process, or browser buffer
addresses.

## Session API

All memory operations require a paused session. Offsets and lengths are exact,
nonnegative integer byte counts. The default budgets are 128 live memory windows
per session and 65,536 bytes per transfer; constructor options
`maxMemoryReferences` and `maxMemoryTransferBytes` can raise these to 4,096 windows
and 1 MiB respectively. Invalid budgets fail during session construction.

| Method | Result and behavior |
| --- | --- |
| `pinMemory(reference, {byteOffset = 0, byteLength, readOnly = false})` | Returns `{memoryReference, address, byteLength, writable}` and owns one counted pin. The reference must identify a live value in this session; an owned, active `ManagedAddress` token also selects a payload offset. |
| `memoryReference(value, options)` | Returns the opaque reference for an inspectable value, or `null` for a value without byte storage. |
| `readMemory(memoryReference, {offset = 0, count})` | Returns `{address, data: Uint8Array, unreadableBytes}`. A range crossing the end returns its available prefix and reports the unavailable trailing count. |
| `writeMemory(memoryReference, bytes, {offset = 0, allowPartial = false})` | Returns `{offset, bytesWritten}`. Complete writes validate the entire range before storing. Explicit partial writes can store the available prefix. |
| `releaseMemory(memoryReference)` | Releases that window; repeated release returns `false`. |

The `memoryReference` string is the capability accepted by subsequent requests.
The displayed hexadecimal `address` is a diagnostic virtual byte address and is
not accepted in its place. Identical windows within a stop share one lease;
different permissions or subranges own separate counted leases. Releasing one
window preserves any independent host pin or debugger window on the same object.

Opening a window reserves its budget slot while acquiring the pin. Pin event
listeners run after that window is cached, so synchronous requests for the same
window share it and requests for another window respect the remaining budget.
Before returning, the opening operation checks its scope and exact pin lease
again. A listener that releases the lease or ends the stop causes that operation
to fail; cleanup preserves any replacement window the listener has opened.

## Supported storage and permissions

Primitive and enum arrays expose their little-endian payload bytes. Int64 storage
retains exact 64-bit values. Boolean byte inspection preserves the stored byte;
the corresponding managed Boolean value follows the existing nonzero rule.
Strings expose read-only UTF-16 little-endian code units, including surrogate code
units. Frozen primitive payloads are also read-only. Reference arrays, boxed
objects, structured value slots, object headers, layout padding, and an implicit
string terminator are outside the memory-view profile.

Every transfer resolves the current storage binding, allocation generation, exact
pin lease identity, and virtual-address owner. Plain replacement arrays and host
instrumentation proxies remain observable through the same synchronization and
publication helpers used by fixed-memory access. Temporary roots protect the
operation while host accessors run. The lease is checked again after a getter and
after publishing a store, so reentrant release, disposal, or a changed debugger
stop cannot authorize a later transfer.

Byte writes target only storage with no managed references. They update the
physical payload, publish affected scalar elements back through the public view,
and advance the heap mutation revision. The debugger advances its write revision
even when a host setter throws after mutation. This preserves history invalidation;
it does not promise transactional rollback of arbitrary host accessor effects.

Write requests validate their capability, permissions, byte bounds, and transfer
budget before capturing debugger history or accessing a managed payload.
`DebuggerMemoryScope.validateWrite()` prepares the shared write operation: it uses
intrinsic typed-array access to check the actual input length and captures bounded
bytes before history or payload callbacks. Its frozen result exposes the effective
`length` and an `execute()` operation that revalidates the destination capability.
Caller-defined length, `subarray`, iterator, and species hooks cannot alter the
captured range or run during its physical store. Temporary write roots use the
existing host-payload scope, which does not advance the heap mutation revision.
Rejected bounds and permissions therefore change neither that revision nor
debugger write history. Zero-byte writes, including partial writes at the window's
end, still validate the current payload and live lease but do not capture a history
checkpoint or evict older entries. Accepted partial writes and host setters that
throw after a store still publish their actual change.

## Collection, snapshots, and disposal

Each live window is a `PinManager` root in the `pinned` category. Full compaction
keeps that object's spatial storage in place while other eligible objects can
move. A same-VM snapshot containing the exact active lease restores its bytes and
virtual address without invalidating the memory reference.

Host revocation is persistent: restoring an older snapshot cannot reopen a released
window. Windows created after the restored snapshot expire. The restore hook also
removes restored leases whose debugger scope has already been disposed, including
scope owners retained only by the snapshot. Foreign-VM snapshots remain subject to
the existing VM ownership checks.

Resume and stepping release every memory window from the previous stop. Session
termination and replacement launch dispose the scope and unregister it from the
runtime. A later inspection uses a new capability identity; old strings cannot
bind to reused allocation slots. Raw heap embedders using `DebuggerMemoryScope`
directly must call its `afterRestore()` after their own heap restore and `dispose()`
when their inspection scope ends. Debug sessions perform both automatically.

## DAP requests

Initialization advertises `supportsReadMemoryRequest` and
`supportsWriteMemoryRequest`. A client declaring `supportsMemoryReferences: true`
receives `memoryReference` on eligible variable and evaluation results. Automatic
pin creation is omitted for clients that do not request memory metadata. The
standard requests use the session limits and base64 byte data:

```json
{"command":"readMemory","arguments":{"memoryReference":"<returned token>","offset":0,"count":16}}
{"command":"writeMemory","arguments":{"memoryReference":"<returned token>","offset":0,"data":"KgAAAA=="}}
```

`sharpforge/pinMemory` accepts exactly one current heap `variablesReference` or
side-effect-free `expression`, plus optional `frameId`, `byteOffset`, `byteLength`,
and `readOnly`. `sharpforge/releaseMemory` releases one returned reference.
Clients declaring `supportsMemoryEvent: true` receive a `memory` event after a
successful write. Invalid, oversized, noncanonical base64, stale, foreign, or
read-only transfers return an unsuccessful DAP response. Releasing an already
expired or unknown reference returns `released: false`. These commands use an
extension dispatch table; existing request dispatch and error handling are retained.

The protocol shape follows the memory requests in the
[Microsoft DAP specification](https://microsoft.github.io/debug-adapter-protocol/specification).
External VS Code/Visual Studio client interoperability and native CLR process
attachment are not qualified by the local adapter tests.

## Implementation and validation scope

`gc/debug-memory.js` owns byte-window validation and the restore hook;
`debugger/memory-session.js` composes it with debugger history;
`protocol/dap-memory.js` owns wire encoding and request handlers. The root provider
and non-allocating scope review are recorded in `root-inventory.js` and
`tests/a06-rooting-reviews.json`. No managed allocation producer is added.

Prepared regressions are `tests/a06-debugger-memory.test.js`,
`tests/a06-debugger-memory-open-observers.test.js`, and
`tests/a06-dap-memory.test.js`, sharing independently authored native CIL and source
fixtures in `tests/a06-memory-fixtures.js`. They cover compaction and replay,
primitive/enum/Int64/Boolean bytes, counted pins, generation and scope rejection,
read-only payloads, bounded partial transfers, host proxy publication/revocation,
pin observer reentry and revocation, and disposal in source, reloaded-source, and
direct-CIL sessions. Execution remains pending the scheduled validation of the
complete scope; no passing result is implied by this implementation record.

`tests/a06-debugger-memory-rejected-write.test.js` additionally covers preflight
without payload callbacks or history changes, zero and partial writes, and a
callback snapshot that cannot revive completed temporary write roots. The prior
`bc720436` full gate retained four rejected-write stamp failures before ending
incomplete at test 1,478 with exit 7; this correction has not yet been executed.

Follow-up static review found unnecessary history eviction on zero-effective
writes and caller-controlled byte-source methods in the physical store path.
`tests/a06-debugger-memory-noop-history.test.js` preserves a full two-entry history
across repeated empty and end-of-window writes, then restores both actual earlier
values. `tests/a06-debugger-memory-input-capture.test.js` covers intrinsic input
branding and bounds, hostile metadata/method hooks, source mutation during history
capture, and live-capability rejection before storing. These follow-up regressions
are prepared for the same complete-scope gate and have not been executed.
