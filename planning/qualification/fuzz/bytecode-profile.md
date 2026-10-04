# Bounded source bytecode execution profile

The #1145 adapter deserializes owned mutated wire images, calls the public
`verifyImage`, then admits a closed subset for actual `VirtualMachine` execution.
The result code `BYTECODE_VERIFIED_BOUNDED_EXECUTED` and its JSON detail identify
this profile. Other verified programs return `BYTECODE_EXECUTION_PROFILE` with
status `unsupported`. This batch does not complete the general-image acceptance
criterion or qualify CIL, Rust, browsers or other operating systems.

## Admitted programs

Programs contain at most four static methods, each returning `int`, with at most
four integer parameters and sixteen local slots. The entry takes no arguments.
Parameter slots are integer locals; other locals may name only `int`, `int[]` or
the exact declared `FuzzBox` type. All methods together contain at most 768 code
words (256 triples). Each method ID matches its array index.

There are at most four integer statics and one exact `FuzzBox` declaration with
at most four integer fields. Static initializers are signed 32-bit integers or
the existing null/default representation. Constants are signed 32-bit integers,
null, or the exact string `int`; that string can supply `NEWARR` metadata but
cannot be loaded as a value. Input cannot name a base type, interface, token,
generic argument, enum, host bridge or external assembly.

The instruction profile adds direct static calls, static loads/stores, fixed
object creation and field access, and integer array creation, element access and
length. Every triple is checked, including verifier-unreachable code. Encoded
constant, local, static, method, type, field and branch indexes are checked before
construction; dynamic array indexes retain the runtime checks. New profiles use
reviewed Int32 arithmetic modes; mode zero remains available only to the original
scalar subset, preserving its first two seed byte sequences. String arithmetic,
intrinsics, delegates, conversions, enums, source points and exception handlers
remain excluded.

## Limits and observations

The active-frame limit changes from the scalar profile's one frame to four,
allowing positive calls. Aggregate managed stack capacity remains 4,096 bytes,
the instruction limit remains 1,024 and the managed heap remains 8,192 bytes.
Frame pooling is disabled. The existing disposable child, input, duration, V8,
observed resident-memory and output limits are unchanged.

Source frame admission reserves stack bytes before acquiring storage. Integer
array allocation reserves its full managed size before constructing the backing
array. The exact-boundary seed has 1,020 elements: its 32-byte header and eight
bytes per element consume 8,192 managed bytes. The finite 1,021-element regression
must reject. Object layout construction is bounded to four fields before the
heap allocator runs. Closed local and metadata names also bound method-table
materialization, which is outside the managed heap quota.

These boundaries reuse the existing [frame admission](../../../packages/runtime/src/execution/call-frames.js),
[managed heap](../../../packages/runtime/src/heap.js) and
[method-table registry](../../../packages/runtime/src/execution/method-table.js).

Accepted detail records contain the actual exit code, executed instruction count,
heap allocation count and peak managed bytes, configured limits and completed
disposal. The adapter checks that no external operation, network transport,
compute service, scheduler or UI window was activated. No host bridge, grant,
callback or VM option comes from input. These observations supplement the closed
instruction admission; the child is not an OS memory or network sandbox.

The exact existing controlled-fault list is unchanged: instruction, stack and
heap limits plus divide-by-zero, overflow and arithmetic faults. Other faults,
including `RuntimeException`, remain findings. An unclassified managed bounds
fault is a conservative finding, not evidence that a native host exception
occurred. A verified image need not satisfy complete runtime type checking.

## General execution remains unqualified

The verifier proves structural properties and stack heights. It does not bound
generic arity in metadata used during method-table construction, which can expand
host arrays before the managed heap exists. It also does not provide a host-call
capability proof. General exception handlers can consume a wrapped host fault,
so final-state inspection alone is insufficient for that profile. General-image
execution needs additional reviewed admission or production guarantees and an
exception observation invariant before it can be qualified.

The relevant production boundaries are the [source verifier](../../../packages/bytecode/src/index.js),
[VM initialization](../../../packages/runtime/src/execution/initialize-source.js) and
[source exception handling](../../../packages/runtime/src/execution/source-eh.js).

The dedicated `tests/conformance/fuzz/bytecode-profile.test.js` covers positive
results, finite allocation boundaries, four-frame success and fifth-frame
rejection, aggregate stack accounting, metadata exclusion, unreachable host
instructions, negative field indexes, cancellation and unchanged fault handling.
Run it only in the scheduled serial validation slot. Source review and authored
tests are not recorded runtime or platform qualification.
