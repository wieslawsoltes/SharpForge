# HashSet capacity and compaction reference

This fixture pins SDK 10.0.201 and CoreCLR 10.0.5 on Linux x64. It emits native
observations for `HashSet<int>.Capacity`, `EnsureCapacity(int)`, `TrimExcess()`
and `TrimExcess(int)`, including constructors, Add growth, UnionWith growth,
removal holes, free-slot reuse, successful compaction and rejected requests.
Execution refuses a different runtime version, operating system or architecture.

The reference implementation is the `dotnet/runtime` tag `v10.0.5`:

- [HashSet.cs](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Collections/Generic/HashSet.cs)
  (blob `026456617f8997dbfd3a50d9e3135f074e2374ce`).
- [HashHelpers.cs](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Collections/HashHelpers.cs)
  (blob `c64f58145ca10ddf5b150ce2967ddb7a6601ad63`).

The root validation scheduler freezes the source before capturing from this
directory, and records SDK/runtime provenance with the capture:

```sh
dotnet run --project HashSetCapacity.csproj --configuration Release --verbosity quiet > ../hash-set-capacity-net10.json
```

The resulting JSON is the native oracle. Do not generate expected capacities
from the SharpForge implementation. This fixture provides no performance data.

The checked-in capture was produced on Ubuntu 24.04.3 LTS x64 with SDK 10.0.201
and CoreCLR 10.0.5. The native build completed with zero warnings and errors.
It contains 41 integer scenarios with 142 steps, five typed observations and
four reflection metadata records. These hashes identify the frozen inputs and
output:

| File | SHA-256 |
| --- | --- |
| `Program.cs` | `698e4295d767165b79411e8df36f2a71575f4b35c42e8788388a88b40d0f4fd1` |
| `../hash-set-capacity-net10.json` | `2b236eb83e4a07cf8485712550c884ccb1736a36b2f7c1e66235c69ee7ad308b` |

## Observation schema

The top level contains `runtime`, `metadata`, `rows` and `typedObservations`.
Runtime fields report the actual framework, runtime version, OS and process
architecture. Reflection metadata reports the Capacity getter and three methods,
using full type names with readable closed generic arguments.

Each integer row contains `name`, `constructor` and `steps`. Constructors use
`kind: "empty"`, `kind: "capacity"` with an integer `capacity`, or `kind: "array"`
with integer `items`. Every row starts with `EnsureCapacity(0)`, a native no-op
that records the constructor's capacity, count and enumeration order.

Steps contain `operation`, optional `argument`, `result`, `fault`, `capacity`,
`count` and `values`. Add/Remove arguments are integers, UnionWith arguments are
integer arrays, and capacity requests are integers. `TrimExcessCapacity` names
the `TrimExcess(int)` overload; `TrimExcess` names the parameterless method.
Void results and absent faults are explicit JSON nulls. Faults record full
managed exception type names, without localized messages. Values preserve
native enumeration order; they are never sorted.

Every capacity-family step additionally records an `iterator` with `moved`,
`current` and `fault`. The fixture creates a public HashSet struct enumerator
immediately before the operation and calls MoveNext afterward, including when
the capacity operation throws. Current is null when MoveNext returns false or
throws. It uses the public GetEnumerator path because interface enumeration of
an empty native set returns a shared empty array enumerator without a set version.
The fixture makes no iterator observations across ordinary Add, Remove, Clear
or UnionWith operations; released SharpForge mutation-version rules outside the
capacity family remain a separate compatibility profile.

The five typed observations use the same capacity step shape for `int`,
`double`, `bool`, `string` and `object`. Their constructor items, surviving values
and successful iterator currents use `{type, value}` records, preserving boxed
integer/double distinctions and null values in the object case.

## Native behavior and compatibility mapping

Array-source construction explicitly binds the real native
`HashSet<int>(IEnumerable<int>)` constructor. SharpForge tests may deliberately
map that input to the released array compatibility constructor; this does not
claim that .NET exposes an array constructor or identical constructor metadata.
The array is still an ICollection at runtime, so native preallocation uses its
length before deduplication. Constructor rows cover the integer shrink threshold
`capacity / distinctCount > 3`, including 7/2 and 11/3 without automatic shrink,
17/4 with shrink, and 17/5 without shrink.

In the pinned source, EnsureCapacity preserves the version even when it grows.
TrimExcess increments it only when the rounded target is smaller than existing
capacity, compacting survivors in their physical order. A rounded no-op retains
holes. Trimming an allocated empty set has a prime floor of 3; a never-allocated
empty set remains at 0. Separate UnionWith rows cover empty input, duplicates,
reuse before growth and a 90-item batch crossing multiple native growth sizes.

The source also places TrimExcess's version increment before Initialize allocates
replacement arrays. A failed native allocation can therefore invalidate an
enumerator while retaining the old capacity and contents: Initialize publishes
the replacement only after both arrays have been allocated. This is a source
observation, not an executed OOM capture. EnsureCapacity does not increment the
version, including on its failed allocation path. The fixture does not provoke
native allocation failure.

The two `native-prime-boundary-*` rows expose native capacities near SharpForge's
backing-array policy: request 968897 and request 968898. The latter rounds to the
native table entry 1162687 and intentionally exceeds the managed one-million
entry backing limit. Tests must distinguish that native observation from an
explicit managed resource rejection. The largest native request is 968898;
the fixture performs no positive Int32.MaxValue allocation.
