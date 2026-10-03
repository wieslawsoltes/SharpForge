# BCL collections

`closedCollectionsModule` provides the released List, HashSet, Queue, Stack,
Dictionary and enumerator families through `@sharpforge/bcl-core`'s
`createBclRegistry`. It exposes `name`, frozen `families`, `group`,
`contracts(registry)` and synchronous `invoke(platform, descriptor, args, type?)`.
Invocation returns `{handled: true, value}` or `{handled: false}` and raises
managed exceptions through the host fault service. The optional resolved type
lets an upper-layer dispatcher avoid resolving an owner more than once.

Framework registration places this module between the core's `bcl-prefix` and
`bcl-suffix` groups. Runtime composition uses one family registry for core and
collection modules. The collection package imports only the core public entry
point; core does not depend on collections, framework or runtime.

`dictionaryEntries(platform, reference)` yields managed `[key, value]` pairs in
Dictionary enumeration order. Upper layers such as JSON serialization use this
public traversal seam without depending on the collection's backing layout.

Hosts supply the same explicit `bclHost`, managed heap, property access,
allocation and write-notification services as core modules. Collection backing
arrays, counts, versions, queue positions and enumerator owners remain in the
managed heap. Lookup caches belong to each platform; Dictionary mutations update
their existing index, while restored heap records rebuild a cache on first use.
Dictionary free-slot metadata is also heap-owned and survives snapshot restore.
Removed keys and values are cleared immediately so they stop retaining objects.

This extraction preserves the released compatibility profile: element types are
`int`, `double`, `bool`, `string` and `object`; Dictionary keys are `string` or
`int`. Range and set inputs use arrays. It does not add open generic collections,
custom comparers or additional members. Dictionary removal takes constant work
and reuses freed entry slots in the order observed in the pinned .NET 10.0.5
fixture. Key/value traversal skips holes in physical slot order. Keys and Values
remain snapshots in this released profile, and mutation versions retain their
existing behavior. Payload array limits remain unchanged; the managed Int32
free-slot array has one extra cell per entry capacity. List and HashSet mutation
costs and default sorting remain separate A08 work.

`tests/a08-dictionary-removal.test.js` covers native slot reuse, cached-index and
backing-array retention, managed-object release, failed growth and heap restore
through both VMs. The root scheduler runs
`node scripts/benchmarks/a08-collection-removal.mjs` on a quiet machine to measure
100,000 removals through each VM platform. Compilation and initial insertion are
outside its timed region; it also rejects index rebuilds or managed allocations.
Performance qualification must use the resulting timings, not the unit tests.

Object collection equality and hash keys retain boxed primitive type identity:
boxed `int` 1 differs from boxed `double` 1.0, while equal boxes of the same type,
NaN, signed zero, strings and null retain their value semantics. Box identity
uses the existing managed MethodTable, including its canonical name for keys;
the collection package does not maintain a second type-alias registry.
`tests/a08-boxed-object-equality.test.js` runs the pinned .NET 10.0.5 source fixture
through both VMs. General source-compiler object-local and object-array boxing
is a separate capability; this regression uses direct BCL object arguments.

`tests/a08-01-closed-collections.test.js` and the unchanged collection cases in
`tests/bcl13.test.js` cover both JavaScript execution engines and assembly reload
paths. Browser and Rust native/Wasm qualification remains a separate gate;
JavaScript test results must not be reported as those targets passing.

`List<string>.Sort(IComparer<string>)` is appended in reserved A08 slot `589824`.
The existing module's `extensionContracts(registry)` registers this addition;
released registration selects `group: 'bcl-collections'`, and appended contracts
select `group: 'extensions'`. The explicit `StringComparer.Ordinal` path supports
nulls, empty strings, duplicates, embedded NUL and isolated/supplementary UTF-16
surrogates. The interface signature allows later comparer implementations without
changing this ABI. Unsupported custom implementations currently raise
`NotSupportedException`, including when the list is empty. A null comparer keeps
the released default behavior. Sort commits one collection version change.

The default string comparator and `Array.BinarySearch` still use the released
ordinal profile. **#829 remains open** for the invariant-culture default, and
#2619/#2621/#2655 track culture comparison and general comparer dispatch. This
increment does not use a host locale heuristic or claim complete culture support.
The pinned .NET 10.0.5 corpus includes invariant and ordinal results, but only the
ordinal results qualify this implementation. Both source and direct CIL tests
consume the capture; browser and Rust native/Wasm qualification is pending.
