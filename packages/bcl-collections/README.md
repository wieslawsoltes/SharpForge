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

Hosts supply the same explicit `bclHost`, managed heap, property access,
allocation and write-notification services as core modules. Collection backing
arrays, counts, versions, queue positions and enumerator owners remain in the
managed heap. Lookup caches belong to each platform and are invalidated by
collection versions. Existing GC visibility and snapshot shapes are retained.

This extraction preserves the released compatibility profile: element types are
`int`, `double`, `bool`, `string` and `object`; Dictionary keys are `string` or
`int`. Range and set inputs use arrays. It does not add open generic collections,
custom comparers or additional members. The maximum collection size, ordinal
sorting and array-rewrite mutation costs remain unchanged.
Hash indexes are rebuilt after legacy removals; this work does not claim the
performance or complete API parity tracked by the remaining A08 issues.

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
