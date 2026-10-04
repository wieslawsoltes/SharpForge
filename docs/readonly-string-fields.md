# Genuine readonly Boolean string fields

This is a prerequisite for **SF-A07-T21 / #783**. The product implementation adds
`System.Boolean.TrueString` and `System.Boolean.FalseString` through a generic
readonly-string field path. Both are real public static readonly fields, with
values `"True"` and `"False"`; no property accessor, language constant, or method
contract ID is introduced.

**Source contract qualification is pending.** The existing A00 structural image
schema and typed method-body adapter must admit and lower the new source carrier.
Those paths are reserved by `codex-p4-abi` under #1062 and #1066. The compatibility
gate and its tests (`scripts/planning/check-contract-change.js` and
`planning/contracts/tests/gates.test.js`) are separately reserved by
`codex-p4-planning` under #1101, on `agent/SF-A00-T10.4` with a lease through
23:59 UTC at handoff. This worktree does not change their schema, gate, or versions,
and does not claim that
source serialization alone proves the complete portable contract. The structural
gate is required before deserialization. Product correctness tests and independent
CIL execution can be qualified separately while that owned prerequisite is
prepared. #783 remains open for the broader Boolean/Object/ValueType scope.

The reviewed owner handoff proposes adding only the closed object carrier to the
flat schema type array, a narrow additive proof that recurses through uniform
`items`, and lowering through the existing typed `load-static` operation. It keeps
the primitive validation-node cost unchanged and recommends no opcode or version
bump. None of those reserved changes is applied here; their qualification remains
with the owners.

## Native field and identity evidence

The [frozen fixture and execution provenance](../packages/bcl-core/reference/boolean-string-fields/README.md)
use SDK **10.0.201**, **.NET 10.0.5**, and Ubuntu 24.04.3 LTS X64. The
[captured JSON](../packages/bcl-core/reference/boolean-string-fields-net10.json)
records exact values, UTF-16 units, reflected field flags and owner/signature,
defining assembly identity, copies, literal identity, interning, collection, and
invariant/en-US/tr-TR/az-Latn-AZ culture observations. The pinned runtime source is
[Boolean.cs at v10.0.5](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Boolean.cs).

| Evidence | SHA-256 |
| --- | --- |
| Program.cs | `8cc63fdef39f630d63cb50718c68de43b759004c059ceb2dc08503d0dfb14dc0` |
| Project | `772eff4e2c0f9b0327bb80d130bf73799ec1f47fb8ff8a7572162535705973d4` |
| Captured JSON | `5155917b117ab8906d00c4863efa0220cd9b0140bd847037418585701dd13d69` |

The field descriptors opt into `System.Runtime` and `System.Private.CoreLib`.
CIL admission preserves and checks the actual raw owner shape, field name,
primitive `string` signature, static operation, approved assembly name/signing
token/neutral culture, and address policy. Versions remain present in metadata
but deliberately do not participate in the facade compatibility decision.
Lookalike signing scopes, named class/value signatures masquerading as primitive
strings, modifiers, writes, and managed addresses are rejected. Local TypeDefs
and locally resolved MemberRefs retain their own storage. The canonical source
profile emits the approved `System.Runtime` facade. The `mscorlib4` emitter
rejects readonly-string loads before output because its legacy token policy
cannot supply that facade identity; no broader assembly allowlist is added.

## Source provenance and field lifetime

Compiler symbols remain `FieldSymbol` instances with static and readonly flags;
`isConst` and `hasConstantValue` remain false. Bound, full semantic, and legacy
lowering retain the canonical registry owner separately from the symbol's
metadata display spelling. Predefined `bool` syntax names the Boolean type;
escaped identifiers such as `@bool` retain ordinary identifier lookup. Locals,
parameters, and source declarations still take precedence over framework aliases.

A source string field read carries this closed data value in `image.constants`:

```json
{"readonlyField":{"owner":"System.Boolean","name":"TrueString"}}
```

The verifier accepts only an own, enumerable, plain data record with exactly the
shown keys and a registered readonly string identity. It rejects accessors without
calling them, inherited/function tags, extra keys, aliases, unknown names, and
numeric-field identities. Owner and field names are bounded. Numeric readonly
fields continue using their existing scalar carriers.

This marker gives the source runtime a reason to retain the managed reference in
its existing `constantValues` cache. An ordinary string constant continues to use
the existing literal pool and remains weak when `weakStringInterning` is enabled.
CIL fields use the existing static-slot map. Both stores already participate in
precise GC roots and execution snapshots; no new VM or heap snapshot fields are
added. Canonical CIL emission writes a genuine `ldsfld` FieldRef, and canonical
reload reconstructs the marker from validated executable metadata before its
existing byte-for-byte re-emission check.

Markers cannot be static default values. Compiler field initializers execute a
field-read instruction and keep a normal null default. VM construction and source
CIL emission reject a marker placed in `image.statics[].value` before guest storage
is initialized. The shared shape verifier also examines static values, but does
not independently enforce this placement rule; tests name the two boundaries that
do. The pending structural schema must preserve the same distinction.

## Allocating initialization and host observers

Registry normalization copies and freezes descriptor data. A string descriptor
contains a primitive host string of at most 1,000,000 UTF-16 code units; null and
other host values are rejected. Managed allocation remains lazy and is subject to
the VM's heap budget. Field reads and matching literals use the same canonical
managed string on each VM. Independent VMs keep separate allocation ownership.

Cold initialization uses two per-platform pending maps: one for canonical field
identities, one for literal texts. No placeholder is inserted into the literal
pool, source cache, or CIL statics. Separating pending field and literal operations
allows either operation to initialize the other from an allocation observer.
After allocation, both paths recheck the pool and reuse a completed nested value
instead of overwriting it. A callback that reads another field may complete that
field even if the enclosing operation later fails.

Reentering the same unfinished field or literal raises `InvalidOperationException`
and marks that operation as failed. Catching this nested error in the host does
not permit the outer operation to publish. Nested cold initialization is bounded
to 128 operations and raises `ExecutionLimitException` at the bound. Every return,
throw, and cancellation releases pending state and callback depth. A host exception
keeps its original identity unless the host explicitly stopped execution first;
in that case cancellation suppresses the unfinished result. Failed allocations
can be retried after the budget or observer is corrected. Completed observer
mutations and allocation/GC accounting are not rolled back.

The existing allocator pins a newly issued reference through its synchronous
observer callback. Field/literal initialization also holds the existing
synchronous-host-callback boundary, so execution snapshot and restore reject an
attempt made from that callback before replacing frames, heap records, or cache
maps. Between-call snapshot and restore remain available. Host code retaining a
managed handle across its own explicit collection must use the existing handle
or explicit-root APIs; a JavaScript local is not a managed GC root.

Explicit `vm.stop()` cancels before pool/cache publication and before the source
CONST, CIL `ldstr`/`ldsfld`, or direct-CIL `String(char[])` constructor can push a
result into retired stack storage. Natural Main completion remains compatible
with direct host reads. Restoring live execution after an explicit stop permits a
new read, using the documented lifecycle query. Existing stop behavior for source
constant caches and CIL statics is unchanged. These observer, reentry, cancellation,
and heap-budget rules are SharpForge host policy, separate from the native field
value/identity observations.

## Qualification and measurement

The focused product files are:

- `tests/a07-boolean-string-fields-registry.test.js` and
  `tests/a07-boolean-string-fields-reference.test.js` for the field-only module,
  immutable descriptors, locked method IDs, pinned native capture, and independent
  Runtime/CoreLib references.
- `tests/a07-boolean-string-field-compiler.test.js`,
  `tests/a07-boolean-string-field-cil.test.js`, and
  `tests/a07-readonly-string-wire.test.js` for symbols, source/IL provenance, exact
  admission, negative signatures/scopes, language restrictions, static-default
  rejection, JSON shape, rollback, and numeric controls.
- `tests/a07-boolean-string-field-lifetime.test.js`,
  `tests/a07-boolean-string-field-reentry.test.js`, and
  `tests/a07-boolean-string-field-cancellation.test.js` for source, canonical reload,
  independent CIL, GC, weak literals, snapshots, both nesting directions, faults,
  real stop callbacks, and retired-stack checks.

Run these serially through `node scripts/limited.js node --test ...` along with the
existing readonly scalar/Decimal, string interning, static-field, allocation-root,
and synchronous-callback regressions. This branch records authored tests and static
review; execution totals belong to the root's final immutable qualification log.
Browser, Rust/native, and Wasm execution parity are not implied by Node or native
reference capture. The A00 structural-schema and typed-method-body prerequisites
need their own owned changes and qualification before portable-source sign-off.

`scripts/benchmarks/a07-boolean-string-fields.mjs` uses the same public package
imports in both worktrees and a fixed five-warmup/nine-sample policy. Copy its exact
bytes to baseline `af5450dacbdc2734432b13dffa63efb10eb93145`; both comparison
revisions contain the merged compiler and Stopwatch prerequisites. Select an engine and a
case in each fresh process, and run each baseline/candidate pair serially in ABBA
order. For example:

```sh
node scripts/limited.js node --expose-gc scripts/benchmarks/a07-boolean-string-fields.mjs 5000 candidate --engine source --case literalCold
```

Existing `literalCold`, `literalLoop`, `staticStringLoop`, and
`readonlyScalarLoop` controls run before new `readonlyStringLoop` work for both
engines. `readonlyScalarLoop` measures the source compiler's tagged scalar
`CONST` and canonical CIL `ldc.i8` lowering of `Stopwatch.Frequency`; it does not
measure a CIL external field instruction. The separate CIL-only
`readonlyScalarFieldLoop` independently authors a genuine `ldsfld` FieldRef for
`Stopwatch.Frequency`, asserts that metadata shape, and sums the loaded Int64
values through the complete interpreter loop. Its first read initializes the
scalar static slot and later reads reuse it; the exact sum and zero managed
allocations are checked. Isolate it with `--engine cil --case readonlyScalarFieldLoop`.

The CIL-only `stringConstructorLoop` control independently authors real
`newobj System.String::.ctor(char[])` instructions. Each fresh VM allocates one
empty character array, then measures repeated constructor and length calls: the
first constructor initializes the empty-string pool entry and later calls reuse
it. The measured interpreter boundary includes that array allocation, the cold
string allocation, loop instructions, and warm constructor calls; it asserts
exactly two managed allocations and the full iteration result. No unsupported
source constructor is compiled, and this case has null source/image hashes with
its actual assembly and runner hashes recorded. Select it with `--engine cil
--case stringConstructorLoop` in each isolated baseline/candidate process.

The cold literal control directly reads distinct literal values on a fresh VM;
loop cases measure interpreter execution including first initialization. Setup,
compilation/admission, explicit host GC, and result checks are excluded; automatic
managed collection remains measured. Raw samples, general median/p95 summaries,
managed allocations/bytes/collections, actual revision, environment, source/image/
assembly hashes, and the runner hash are recorded. No speedup or regression figure
is claimed until the root performs the isolated comparison.

The remaining #783 work includes Boolean methods and the broader Object/ValueType
acceptance. This field prerequisite does not close that issue.
