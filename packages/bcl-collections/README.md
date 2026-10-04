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
`int`. Range and set inputs use arrays. Open generic collections and custom
comparers remain outside this profile; appended members are described below. Dictionary and HashSet removal take constant work
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

## HashSet capacity and compaction — SF-A08-T13

The complete capacity family is appended after A08's existing ordering contract:

| Closed HashSet element | Capacity getter | EnsureCapacity(int) | TrimExcess() | TrimExcess(int) |
| --- | --- | --- | --- | --- |
| `int` | 589825 | 589826 | 589827 | 589828 |
| `double` | 589829 | 589830 | 589831 | 589832 |
| `bool` | 589833 | 589834 | 589835 | 589836 |
| `string` | 589837 | 589838 | 589839 | 589840 |
| `object` | 589841 | 589842 | 589843 | 589844 |

`Capacity` counts entry slots. `EnsureCapacity` returns the existing capacity when
sufficient and otherwise rounds the request using the .NET 10.0.5 HashHelpers
prime table. The parameterless constructor and capacity-zero constructor begin
unallocated with capacity zero. Add growth uses the native prime expansion policy.
Array construction preallocates from the input length and applies the native
integer-division duplicate-shrink threshold. Union preallocates the same final
capacity that sequential native insertion would reach, retaining the released
bulk-allocation failure guarantee. Dictionary continues through its existing
storage path.

`TrimExcess()` delegates to the count-based request. `TrimExcess(int)` rejects a
request below Count, preserves storage when prime rounding would not shrink it,
and otherwise compacts live slots in their previous traversal order. Freed slots
are removed and subsequent insertion starts after the compacted live prefix.
The minimum allocated native capacity is three, including trimming an allocated
empty set. Trimming an unallocated set leaves its capacity zero.

EnsureCapacity and no-op trimming preserve enumerator versions. An actual trim
advances the version **before allocation**, as in the native source. Thus a failed
trim allocation retains the old capacity/content but may invalidate enumeration;
failed EnsureCapacity growth preserves both content and version. New backing and
slot arrays are published together after allocation. Index caches are invalidated
immediately before compaction publishes, including a cache populated by a version-write observer.
Old and new backing references remain rooted throughout write-notification delivery.

The early trim-version notification is observable to host hooks. If such a hook
mutates the set, trimming re-reads its backing and revalidates the requested count
before preparing a layout. A thrown version observer leaves the advanced version
and old storage; a thrown backing observer leaves the already-published complete
layout. These host-hook tests are distinct from native allocation-failure evidence.
The native fixture captures ordinary iterator behavior; failed-native-allocation
ordering is established from the pinned runtime source, not a native OOM experiment.

Synchronous allocation observers are a separate callback boundary. Each resize
checks this set's owner tuple, version, backing references and backing identities
after allocation and against the intended state after publication. A conflicting
same-set mutation raises `InvalidOperationException` with diagnostic `BCLHS0002`
and retains the observer's state; it never restores stale prepared values. Reads,
collection and unrelated same-heap changes remain allowed. A publication observer
can see committed storage, so rejection at that boundary does not roll it back.
The allocator keeps newly committed records and explicit one-shot allocation roots
alive through synchronous notifications, including nested collection and failure.

The optional BCL host lifecycle query distinguishes explicit VM stop from ordinary
completion of Main. A stop during resize allocation or publication cancels the
pending storage work and the Add, Union or array-construction continuation that
requested it. Trim and constructor version notifications also give explicit stop
precedence over an observer error; errors from active observers retain their
original identity. Getters remain available for inspection, and naturally
completed programs still support host calls. Source/CIL call boundaries discard
stopped results; the framework constructor path also avoids repopulating a retired
caller stack. Heap snapshots continue to contain only managed collection state,
without host continuation checkpoints.

The existing one-million-element backing-array limit remains. The largest native
table capacity fitting it is **968897**. Growth that requires the next capacity,
1162687, raises `OutOfMemoryException` with diagnostic `BCLHS0001` before changing
storage. The independent native capture demonstrates that .NET itself supports
the larger request. Heap budgets can reject smaller allocations as well. Large
valid TrimExcess requests that cannot shrink existing storage remain no-ops.
Legacy constructor input bounds remain in the released constructor adapter.

All capacity state, slot markers, versions and values remain heap-owned and restore
with snapshots. A restored legacy dense snapshot retains its recorded capacity,
including an older nonprime value, until a requested growth or compaction; reads
do not silently rewrite that state. Multiple VM platforms keep independent caches.
Capacity/no-op calls take constant bounded work. Resizing takes O(new capacity)
space and work; compaction additionally visits the old used slot prefix.

`reference/hash-set-capacity/Program.cs` and `hash-set-capacity-net10.json` contain
the frozen SDK 10.0.201 / CoreCLR 10.0.5 Linux x64 reference: 41 integer scenarios,
142 steps, five typed observations and four reflected method signatures. The native
array constructor binds `IEnumerable<T>`; platform/source fixtures explicitly map
it to the already-released array compatibility constructor. Independently authored
CIL uses genuine parameterless/int constructors and capacity MemberRefs, without
that adapter or a source compiler. Tests also cover bound/legacy source pipelines,
both JavaScript VMs, observer GC/failures, snapshot replay and Dictionary controls.
Browser and Rust native/Wasm execution remain unqualified by these JavaScript tests.

This batch does not close [#816](https://github.com/wieslawsoltes/SharpForge/issues/816).
Remaining work includes comparer-aware hashing and constructors, arbitrary
IEnumerable inputs, the remaining set algebra/relations, TryGetValue, RemoveWhere,
CopyTo, CreateSetComparer, ISet and IReadOnlySet. Existing array-only set-operation
signatures and released enumerator mutation/disposal differences remain explicit.

The allocation-failure regression in `tests/a08-hashset-removal.test.js` now fills
capacity seven before forcing growth. Its previous four-element setup assumed
the old nonnative growth policy; all failure/content/version assertions remain.

For serial before/after measurements, copy the identical committed runner into
the compared worktrees. This batch compares baseline `5fc1286d` with product
revision `6b1c4e72`, including the allocator and lifecycle prerequisites:

```sh
node scripts/limited.js node --expose-gc scripts/benchmarks/a08-hashset-capacity.mjs 2000 REVISION
```

The runner uses static public package imports and fixed legacy compilation. Eight
existing HashSet/Dictionary controls measure Add growth/spare capacity, lookup and
free-slot reuse. Five candidate workloads measure Capacity, no-op ensure/trim,
actual growth and compaction. Baseline records missing capacity methods as
unsupported without timing a substitute. Each workload uses one warmup and five
samples, reporting median/p95, raw timing, managed allocation/byte/collection counts
and writes. Setup, compilation, explicit GC and assertions are outside timing;
automatic managed GC and the write counters remain inside. Cohorts prepare one
set per timed growth/trim call, so repeated calls cannot become accidental no-ops.
Behavioral checks run after each sample. The implementing pull request retains the
fresh-process ABBA measurements, allocation controls, and explicit budget exceptions.
Results describe these JavaScript workloads on the recorded shared host.
