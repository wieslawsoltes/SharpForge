# Virtual declaration slots

This bounded [T02.1](https://github.com/wieslawsoltes/SharpForge/issues/1354)
increment reuses the CIL verifier's existing declaration tables and the runtime's
MethodTable/cast-cache architecture. It adapts the assembled E01 target-vector
and abstract-dispatch adapter without importing its generic call machinery.

Each assembly-derived dispatch table retains its declaration and MethodImpl
identity maps and gains an immutable dense target vector. Alias chains are
resolved while constructing that vector. Warm `callvirt` selects the declaration
slot and indexes its target; it does not walk inheritance or MethodImpl aliases.
MemberRef declaration resolution is cached alongside the canonical MethodDefs,
so dispatch does not reparse method signatures.
`call` still invokes the exact declaration, allowing explicit base calls.
New slots remain independent, and final-slot override validation is unchanged.

The runtime adapter raises managed `MemberAccessException` for an abstract
dispatch target. The verifier continues to reject a call site with no reachable
concrete implementation, and incompatible receivers retain their existing
metadata diagnostic. Tables are derived from the inspector and use the existing
type-system replacement on metadata changes; snapshots do not serialize them.

Prepared tests cover declaration/MemberRef identity, base calls, virtual hiding,
sealed overrides, chained MethodImpl mappings, abstract and incompatible
receivers, malformed cyclic mappings, snapshot replay and 100,000 warm lookups
with no alias resolver calls. Existing B03 tests retain malformed signature,
duplicate MethodImpl and illegal final-override coverage. Their independent
metadata assembler is shared rather than copied.

`tests/fixtures/a05/virtual-slots` is a runnable .NET 10 reference fixture with
expected output; the native fixture has not run. Serial validation at
`86189289` passed all 59 tests in `a05-02-virtual-slots`, `a05-b03-dispatch`,
`a05-type-tables` and `a05-delegate-targets` under Node 24.21.0 with one worker
and a 512 MB heap cap. Static/manifests and build validation use the required
core check. Broader qualification and latency/allocation measurements remain
queued.

```sh
dotnet run --project tests/fixtures/a05/virtual-slots/VirtualSlots.csproj
```

| Capability | Delivery boundary |
| --- | --- |
| Direct CIL virtual slots | Nongeneric in-assembly class declarations and MethodImpl aliases |
| Snapshot/reload | Uses existing metadata-derived cache lifetime; no new serialized state |
| Source frontend and Rust/Wasm | Unchanged and not independently qualified by this increment |

Generic/external virtual declarations, default interface methods and diamond
resolution remain separate open work under T02/T02.2. Source compiler lowering,
browser/native execution and Rust/Wasm backend parity are not claimed by this
code-only delivery.
