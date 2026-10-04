# Portable A05 execution snapshots

Work item: SF-A05-T06.3 / #1388.

The runtime exports a dependency-free, JSON-safe graph codec. Numbered references
preserve cycles and aliases; BigInt, undefined, infinities, negative zero,
ManagedFault, Map, Set, typed arrays and immutable managed values keep their
categories. Typed payloads preserve raw bytes, including NaN payload bits.

```js
import {serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const paused = vm.snapshot();
const json = await serializeSnapshot(vm, paused, {json: true});
await restoreSerializedSnapshot(freshVmWithIdenticalCode, json);
const resumed = freshVmWithIdenticalCode.run();
```

Runnable source/CIL example: `node examples/runtime/portable-snapshot.js`.

| Export | Result / behavior |
| --- | --- |
| `serializeSnapshot(vm, snapshot = vm.snapshot(), options = {})` | Promise of a JSON-safe object; `{json: true}` returns JSON text. |
| `deserializeSnapshot(vm, payload, options = {})` | Promise of a validated local snapshot rebound to `vm`; does not replace live execution state. |
| `restoreSerializedSnapshot(vm, payload, options = {})` | Deserialize and invoke the same coherent `vm.restore` path; returns `vm`. |
| `portableSnapshotVersion` | Wire format version `1`; header also carries execution schema version `2`. |
| `SnapshotFormatError` | `TypeError` subclass with a stable `SNAPSHOT_*` code. |

## Identity and boundaries

The header binds to exact SHA-256 source-image or PE bytes, execution engine,
entry point, native integer width, snapshot schema and host-operation revision.
Web Crypto SHA-256 is required. The digest operation verifies that code did not
change while awaiting its result. Method identity is encoded by verified
MethodDef token plus closed generic owner/arguments. Runtime type identity is
encoded by canonical type name and resolved in the receiving registry. Managed
heap references and function pointers are issued again through the destination's
existing ownership factories; copying an `{h, g}` shape does not grant ownership.

Portable snapshots do not transfer host functions, native resources, callbacks,
permissions, network grants, worker processes, a Wasm module instance or pending
external operations. The destination keeps its own host configuration and
callbacks. An active external operation or a different revision reports a
failure instead of pretending the external effect can be reversed. Generic
cache/type resolution remains isolated or rolls back newly materialized type
entries when input is rejected.

Both JSON text and structured-cloned objects are bounded by `maxBytes` (64 MiB),
`maxNodes` (1,000,000), and `maxItems` (8,000,000), with explicit option validation.
Object inputs must contain plain JSON data and no accessors; accessors and
functions are rejected without executing them. Graph decoding allocates and
validates before any guest heap/frame/scheduler replacement. Prototype-bearing
objects, invalid identities, malformed graph edges, foreign code, ABI mismatches,
and revision mismatches report typed errors.

## Verification and qualification status

Authored coverage is in `tests/a05-06-portable-snapshot.test.js`: fresh-instance
source/CIL replay via JSON and structured clone; typed payload bit preservation;
cycles and aliases; rebinding local addresses and callable pointer provenance;
closed generic methods; malformed graph/header/budget rejection; and accessors
that must not execute. Exact commands for the staged serial slot:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node --test tests/a05-06-portable-snapshot.test.js tests/a05-06-coherent-snapshot.test.js tests/a05-06-snapshot-cow.test.js tests/a05-seams-snapshot.test.js
node scripts/limited.js node examples/runtime/portable-snapshot.js
```

These commands have not yet been executed for this integration batch. Browser
worker transfer, independent platform qualification and cold/warm/p95/p99 latency
and allocation measurements remain pending; JSON/structured-clone fixture
coverage is not a claim that native targets have been qualified.
