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
`hashSetValues(platform, reference)` similarly yields managed HashSet values,
including null, in physical slot order. Neither iterator unwraps managed values.

Hosts supply the same explicit `bclHost`, managed heap, property access,
allocation and write-notification services as core modules. Collection backing
arrays, counts, versions, queue positions and enumerator owners remain in the
managed heap. Lookup caches belong to each platform; Dictionary and HashSet mutations update
their existing index, while restored heap records rebuild a cache on first use.
Their free-slot metadata is also heap-owned and survives snapshot restore.
Removed keys and values are cleared immediately so they stop retaining objects.

This extraction preserves the released compatibility profile: element types are
`int`, `double`, `bool`, `string` and `object`; Dictionary keys are `string` or
`int`. Range and set inputs use arrays. It does not add open generic collections,
custom comparers or additional members. Dictionary and HashSet removal take constant work
and reuse freed entry slots in the order observed in the pinned .NET 10.0.5
fixture. Key/value traversal skips holes in physical slot order. Keys and Values
remain snapshots in this released profile, and mutation versions retain their
existing behavior. Payload array limits remain unchanged; the managed Int32
free-slot array has one extra cell per entry capacity. HashSet enumeration, array
copies, JSON serialization and set algebra visit live physical slots, including
null values. ExceptWith removes in input order; IntersectWith removes in physical
order, retaining native free-slot reuse. Array construction deduplicates through
the existing index. Released enumerator mutation-version/disposal rules remain
unchanged and do not claim complete .NET enumerator parity. List RemoveAt and
RemoveRange shift the surviving suffix inside existing storage and clear the
vacated tail. Tail RemoveAt takes constant work; arbitrary removals still require
linear shifts. Valid empty ranges avoid backing writes and retain the released
version increment. Remove(value) retains its linear first-match lookup and reuses
the same in-place removal seam. Clear writes null only to live entries and keeps
capacity; an empty Clear preserves its released no-op version rule. Insert and
AddRange reserve once before mutation when growth is needed and otherwise reuse
their backing storage. Insert shifts only its suffix; AddRange writes only the
appended elements. Reverse swaps only the live prefix in place, with one reusable
temporary GC root protecting each displaced reference through write observers.
Empty/singleton Reverse performs no slot writes but increments the version.
Sort retains its existing storage path.

`tests/a08-dictionary-removal.test.js` and `tests/a08-hashset-removal.test.js` cover
native slot reuse, cached-index and backing-array retention, managed-object
release, failed growth and heap restore through both VMs. The root scheduler runs
`node scripts/benchmarks/a08-collection-removal.mjs` on a quiet machine to measure
100,000 removals for both families through each VM platform. Compilation and initial insertion are
outside its timed region; it also rejects index rebuilds or managed allocations.
Performance qualification must use the resulting timings, not the unit tests.

`tests/a08-list-removal.test.js` covers the narrow List removal change on both VMs,
including native result/capacity checks, slot notifications, invalid ranges, GC,
allocation failure and heap restore. Copy the same committed
`scripts/benchmarks/a08-list-removal.mjs` runner to a baseline checkout for serial
comparisons of tail and middle-range removal. It reports backing replacements
and slot writes, and accepts an optional item count (default 2,000).
`tests/a08-list-value-removal.test.js` separately covers first-match equality,
Remove/Clear notifications, GC, unchanged no-op versions and allocation failures.
`scripts/benchmarks/a08-list-value-removal.mjs` compares tail-value lookup/removal
and Clear using the same static-import baseline workflow. It makes no claim that
value-based List lookup becomes constant-time.
`tests/a08-list-insertion.test.js` covers native results/capacity, exact writes,
single-reservation growth, empty input, validation, failed growth, GC and restore.
`scripts/benchmarks/a08-list-insertion.mjs` measures tail insertion and singleton
AddRange with spare capacity using the same static-import baseline workflow.
`tests/a08-list-reverse.test.js` covers native values/capacity, exact swaps,
empty/singleton versions, observer-triggered GC, throwing observers, allocation
failure and heap restore. `scripts/benchmarks/a08-list-reverse.mjs` measures
repeated reversal with exact and spare capacity through the same VM dispatch.

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
`NotSupportedException`, including when the list is empty. A null comparer uses
the shared default ordering provider. Sort commits one collection version change.

Default List.Sort, Array.Sort and Array.BinarySearch strings share the BCL core
host-backed `invariant-host` provider. The provider fixes English standard/root
collation options and preserves comparator-zero search equality. This is a partial
profile: the initial Node 24.21.0/ICU 78.3 probe matches all 9,409 pinned .NET 10.0.5
corpus comparisons but differs on five additional normalization boundary pairs.
**#829/#2619/#2621 remain open** for an exact backend and managed culture APIs;
#2655 tracks general comparer dispatch. Explicit Ordinal remains UTF-16 based.
Both VM platforms consume the full original capture without assuming a stable
order for culturally equal keys. Compiled source supports direct StringComparer
calls and registered interface upcasts, including
`values.Sort(StringComparer.Ordinal)` and comparer locals/parameters/returns.
Custom implementations, interface type tests and casts needing runtime checks
remain explicitly diagnosed.
Independently assembled CIL exercises interface Compare/List.Sort and runtime
casts. Unsupported custom comparer objects are checked through both platforms,
including an empty List. Browser and Rust native/Wasm qualification is pending.

Run `node --expose-gc scripts/benchmarks/a08-default-string-sort.mjs 8192 invariant-host`
in the candidate and use `8192 released-ordinal` in Sort storage baseline
`186b3045`, serially, copying the identical runner to the baseline first.
The bounded control uses 8,192 deterministic nullable digit strings
by default, one warmup and five samples for each VM platform. It initializes the
per-platform provider before timing default Sort dispatch and reports median/p95
plus managed allocation counts and bytes; compilation, input setup and output
checks are excluded. Both profiles produce the same order for this input subset.
This measures the default path, including the chosen host collation backend, rather than
explicit-comparer overhead. Record the host ICU version alongside its timings.

List Sort now copies and roots only the live prefix, sorts that copy through the
existing ordering helper, and writes it into the same backing array through the
shared write-notification seam. Capacity and backing identity stay unchanged;
comparer failures leave values/version unchanged. Fresh empty Sort succeeds and
increments the version, matching the pinned .NET 10.0.5 fixture. Every pending
managed value remains rooted across observer-triggered collection during
writeback; temporary roots are released even when an observer throws. Observer
exceptions may expose completed writes, like other observed collection writes.

The temporary copy and root set use O(Count) space, comparison retains the
existing sort complexity, and writeback visits Count slots rather than Capacity.
`tests/a08-list-sort-storage.test.js` covers both VM platforms, native results,
snapshots, fault cleanup, notifications and forced GC. Run the identical
`node --expose-gc scripts/benchmarks/a08-list-sort-storage.mjs` in the ordinal
parent and this branch, serially, to measure default/ordinal Sort with spare
capacity. It reports one warmup and five samples per workload, median/p95,
observed host heap deltas, backing replacements and managed allocation counts.
No culture behavior or comparer-callback support changes in this storage batch.
