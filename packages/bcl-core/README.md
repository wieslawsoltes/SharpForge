# BCL core

This package owns BCL family contracts and managed implementations. It has no
runtime or framework dependency. Hosts supply `bclHost.fault(type, message)`,
`bclHost.isReference(value)` and `bclHost.frameworkType(name)` on each platform.
The fault service must throw the host's managed exception.

`createHostStringOrdering({Collator})` creates a synchronous nullable-string
comparer with immutable host provenance. `Collator` defaults to `Intl.Collator`;
the optional constructor supplies a test seam, not a managed callback API.
`defaultStringOrdering(platform)` privately caches one provider per platform.
Missing English standard collation or unsupported resolved options raise
`NotSupportedException`; there is no ordinal fallback.

Default List sorting, Array sorting and typed/null-comparer Array.BinarySearch
share this host-normalized `invariant-host` profile. It explicitly requests English
standard/root collation, tertiary sensitivity, no numeric ordering, no case-first
override and significant punctuation. Explicit StringComparer.Ordinal remains
UTF-16 ordinal. Comparator zero, including culture-equal distinct strings, is
BinarySearch equality. Sort does not promise an order within equal-key groups.

This profile follows host Intl/ICU data. It does not pin ICU, implement managed
thread CurrentCulture (#2616), or complete CompareInfo/StringComparer culture
APIs (#2619/#2621). Browser ICU versions may be unavailable. In particular, Intl
normalization differs from the pinned native .NET default on five combining-mark
boundary pairs: the host considers them equal while native .NET distinguishes
them. The separate native boundary oracle and `scripts/probe-string-ordering.mjs`
report those differences; issues #829/#2619/#2621 remain open for an exact backend.
See [the reference](reference/culture-ordering-boundaries/README.md).

`String.CompareOrdinal(string, int, string, int, int)` is appended at A07 slot
`524298`, after OrdinalIgnoreCase `524297`; the released two-string overload and
its return behavior remain unchanged. The range overload compares UTF-16 units
directly without substring allocation or normalization. Null ordering precedes
all index/length validation. Non-null strings validate length, negative indices
and then endpoints before zero-length or equal-range shortcuts. Requested lengths
are clipped separately to the two remaining suffixes. Invalid ranges raise
ArgumentOutOfRangeException with the relevant parameter named in the diagnostic.

The comparison takes O(units compared), constant auxiliary space and no managed
allocation. The 58-case .NET 10.0.5/SDK 10.0.201 capture covers actual results,
faults, validation priority, prefix lengths, Int32 bounds and split/lone surrogate
units through compiled source/CIL and independently assembled CIL. This is one
ordinal range overload; #2621 remains open for the remaining comparison/culture APIs.
Run the identical `node --expose-gc scripts/benchmarks/a07-string-compare-ranges.mjs`
runner serially in baseline `aab81434` and this branch. It reports the existing
two-argument control separately from new range cost, using one warmup and five
samples per real VM platform, median/p95 and managed allocation counters. Setup
is excluded; the absent range overload is explicitly skipped on the baseline.

`String.Equals(string, string, StringComparison)` and instance
`String.Equals(string, StringComparison)` occupy A07 slots `524299` and `524300`.
They support only `Ordinal` and `OrdinalIgnoreCase`, reusing the existing streaming
ordinal fold. The registered `System.StringComparison` enum exposes all six native
constants so other values bind correctly, but culture modes 0–3 explicitly raise
`NotSupportedException`, including identity and null-argument shortcuts. This is a
deliberate partial profile, not an implementation of native culture equality.
Values outside 0–5 raise `ArgumentException` naming `comparisonType` before equality
or null-argument shortcuts. A null instance receiver raises `NullReferenceException`
before mode validation. The released two-string Equals contract remains unchanged.

The unchanged 220-row .NET 10.0.5/SDK 10.0.201 reference includes both overloads,
fault precedence, separately allocated equal strings, Unicode casing, embedded NUL,
malformed UTF-16 and native culture controls. Tests distinguish native ordinal
parity from explicit culture rejection, using both compiler pipelines/VMs and
independently assembled CIL. Named enum constants in bound source depend on the
separate registered-enum compiler lowering prerequisite. Comparison takes O(n)
time, constant auxiliary space and no managed text allocations. The bounded
`scripts/benchmarks/a07-string-equals-comparison.mjs` runner measures the unchanged
two-string control before/after `82ec8ed4` and reports new overload costs separately.
Setup is excluded; one warmup and five samples report median/p95 and managed
allocations on both real VM platforms. #2621 remains open for culture modes, other
comparison overloads, comparer equality/hash and factories.

`String.Compare(string, string, StringComparison)` occupies A07 slot `524301`,
after the two Equals overloads. It reuses the same mode validation and existing
Ordinal/OrdinalIgnoreCase comparers. Invalid enum values raise `ArgumentException`
naming `comparisonType` before null/identity shortcuts; culture modes 0–3 explicitly
raise `NotSupportedException` in the same position. Nulls precede non-null strings.
Only the result sign is specified, including supplementary and malformed UTF-16
ordering; the two-string CompareOrdinal contract and Equals IDs are unchanged.

The [122-row .NET 10.0.5 reference](reference/string-compare-comparison/README.md)
retains native raw results and signs separately. Tests cover both compiler
pipelines/VMs, independent CIL, all captured faults, collection of pinned inputs,
and zero managed text allocation. Comparison takes O(n) time in the inspected
prefix and constant auxiliary space. Run the identical bounded
`scripts/benchmarks/a07-string-compare-comparison.mjs` runner serially on baseline
`9838196d` and the candidate: existing CompareOrdinal and both mode-aware Equals
controls are separate from the new Compare costs, with one warmup, five samples,
median/p95 and managed allocation counts. This completes only this three-argument
overload; #2621 remains open for culture support and the other comparison APIs.

`String.StartsWith(string, StringComparison)` and `String.EndsWith(string,
StringComparison)` append at `524302` and `524303`, after mode-aware Compare
`524301`. Both support `Ordinal` and `OrdinalIgnoreCase`. Null receivers fail first;
a null `value` raises `ArgumentNullException` naming `value` before mode validation.
Invalid modes raise `ArgumentException` naming `comparisonType` before identity,
empty-value or length shortcuts. Valid culture modes 0–3 explicitly raise
`NotSupportedException` after null checks, including otherwise trivial matches.
The existing one-argument contracts retain their released behavior.

Ordinal-ignore-case affixes reuse the ordinal fold in a bounded UTF-16 loop. A high
surrogate at a prefix endpoint stays isolated even when the original string has a
following low surrogate; a suffix beginning at a low surrogate never reads the
preceding high surrogate. No substrings or folded strings are allocated. Comparison
takes O(value length) time and constant auxiliary space; the whole-string comparator
is unchanged. The pinned 264-row native capture retains native culture controls and
tests their deliberate profile differences separately, across both pipelines/VMs
and independent CIL. It also covers scan-width boundaries, malformed UTF-16, casing,
NUL, identity, longer values and fault precedence. See
[the capture instructions](reference/string-affix-comparison/README.md).

Run `node --expose-gc scripts/benchmarks/a07-string-affix-comparison.mjs` serially
against Compare-only parent `f9292ef3` and this branch. The identical runner separates
released one-argument controls from new mode-aware costs, with setup excluded,
one warmup, five samples, median/p95 and managed allocation counters. No speedup
is claimed; culture affixes and the rest of #2621 remain open.

`StringComparer.OrdinalIgnoreCase` is a separate managed singleton, shared by
the registered string/object Compare, IComparer, List.Sort and Array.BinarySearch
routes. Its streaming fold reuses the pinned simple-uppercase table without
allocating transformed strings. The native 10.0.5 capture excludes long s and
Garay lowercase letters from invariant-uppercase equivalence and orders complete
supplementary scalars above BMP characters and isolated surrogate units. These
rules preserve embedded NUL and malformed UTF-16 without replacement or expansion;
sharp s does not equal SS. Nulls precede strings, and only the comparison sign is
specified. See [the pinned cases](reference/ordinal-ignore-case/README.md).

Comparison uses O(n) time in the inspected prefix, constant auxiliary space and
no managed allocations after singleton construction. Ordinal remains a UTF-16
comparison. Other StringComparison overloads, comparer equality/hash APIs,
CurrentCulture/InvariantCulture comparers and comparer factories remain tracked
by #2621; this batch does not qualify native/Wasm or other globalization versions.

Each family module has `name`, `families`, `contracts(registry)` and
`invoke(platform, descriptor, arguments)` members. Invocation returns
`{handled: true, value}` or `{handled: false}` synchronously. Module registration
is validated before publication, with a constant-time family lookup per call.
Registries are independent and immutable; managed state stays in the host heap.
`registry.invoke` and `invokeBclModules` accept an optional fourth argument with
the already resolved owner type. The registry passes it to the module's `invoke`
method; omitting it retains the host lookup, and `null` means an unknown type.

Add a module to `src/modules.js` to make it available to framework registration,
runtime dispatch and the generated inventory. The extracted release 13 and 14
modules use explicit registration groups to preserve every existing contract ID.
New modules use the `extensions` group in the reserved A07 range. Registering a
module through the framework remains transactional.
An existing module may provide `extensionContracts(registry)` for additional
members in that reserved range. The `extensions` registration group invokes
this hook separately from the module's released `contracts` hook; both hooks
must be synchronous. Registration without a group, including selection by
module name, invokes both hooks in order. The caller supplies the ID reservation;
framework composition uses the separate groups to preserve released IDs.

Run `node packages/bcl-core/scripts/inventory.js` to regenerate the documented
surface; `--check` compares the checked-in output. Public String, StringBuilder,
Array and Random metadata is pinned to .NET 10.0.5 and SDK 10.0.201, with native
extractor and source hashes. Exact signature presence is reported separately
from behavioral qualification; this extraction does not claim complete BCL parity.

`formatDoubleDefault(value)` formats a JavaScript binary64 number as invariant
.NET default text, including signed zero, shortest round-trip digits, uppercase
exponents padded to two digits, and the `NaN`/`Infinity` spellings. It is pure and
does not allocate managed memory. The shared numeric formatter also supports
`G`/`g` with the existing 0..99 precision limit and `R`/`r` for floating-point
values. The fifty-value .NET 10.0.5 fixture in `reference/double-format-net10.json`
qualifies binary64 default, general and round-trip output; it does not qualify
Single or Decimal formatting. Runtime display adapters reuse this helper while
retaining their engine-specific object, enum and typed integer handling.

StringBuilder reports the .NET default `MaxCapacity` of `Int32.MaxValue`
(`2147483647`) in both metadata and execution. The host separately limits text
and requested capacity to 1,000,000 UTF-16 code units. Exceeding that allocation
budget raises `OutOfMemoryException`; negative capacities and capacities below
the current length raise `ArgumentOutOfRangeException`. The host budget is not
a claim that allocations up to .NET's maximum can be satisfied. Constructor
defaults are captured in `reference/builder-format/oracle.json` against the
pinned .NET toolchain, and source/direct CIL regression tests consume the capture.

Composite formatting follows the pinned .NET brace and ASCII-space grammar:
`{0 ,5}` is valid, `{ 0}` is invalid, and escaped closing braces after a format
item are processed as literal text. StringBuilder retains text written before
a later malformed item raises `FormatException`. Its `AppendFormat(string,
params object[])` overload supports expanded arguments, an explicit array and
zero arguments through the compiler's existing params lowering. The new
overload occupies reserved A07 ID `524288`; released IDs remain unchanged.
Formatting still uses the supported invariant numeric formats and the host's
1,000,000-unit output budget, rather than claiming the full .NET formatting API.

`Object.ToString` invokes the existing StringBuilder and Uri overrides when the
receiver is held as `object`. Their parameterless contracts explicitly opt in
with `objectToStringOverride: true`; names alone never enable virtual dispatch.
The runtime supplies the optional `bclHost.invokeObjectToString(platform, value)`
service and resolves exact managed framework types through existing handlers.
This keeps core independent of runtime/framework imports and preserves released
contract IDs 812 and 1542. No managed receiver is retained in the dispatch index.

Source object calls and CIL `callvirt` use this path. CIL `call` retains the base
type-name result for these framework objects; either opcode faults on null.
Compiled Object.ToString now emits that instance `callvirt` directly, and profile
loading keeps it distinct from static Convert.ToString. Existing static Convert
bodies retain Convert semantics, including when loaded back into the source VM.
The 22-row [.NET 10.0.5 capture](reference/object-string/README.md) records actual
native instructions, including hidden methods and primitive controls. Existing
primitive, Convert and Console formatting profiles remain unchanged; primitive
nonvirtual calls are not newly qualified as native-compatible. Other framework
overrides and arbitrary managed callbacks require separate explicit support.
The static benchmark `scripts/benchmarks/a07-framework-object-string.mjs` reports
the unchanged primitive control and newly virtual framework cases separately;
copy it to baseline `82ec8ed4` for a serial comparison with setup excluded.

`StringComparer.Ordinal` is a platform-rooted singleton and implements the
registered `IComparer<string>` interface. `Compare(string, string)` orders null
first, then compares exact UTF-16 code units without normalization, case folding
or locale services. Closed `IComparer<string>` and `IComparer<object>` metadata
seeds the existing generic bridge, including contravariance and abstract methods.
`resolveStringComparer(platform, reference)` validates a managed built-in comparer
once and returns a synchronous `(nullableString, nullableString) => number`
comparison function. Its sign expresses ordering. It allocates no managed memory;
null receivers raise `NullReferenceException`, and unsupported implementations
raise `NotSupportedException`. Collections reuse this helper through the public
core entry point. Custom managed callbacks remain tracked by #2655.

`StringComparer` also implements non-generic `System.Collections.IComparer`.
Its `Compare(object, object)` overload preserves reference identity and null
ordering, compares strings ordinally, and uses the existing managed primitive
identity for compatible boxed values. Different primitive types and objects
without IComparable raise `ArgumentException`; arbitrary managed IComparable
callbacks remain explicitly unsupported under #2655. NaN sorts first and
compares equal to NaN. The new contracts occupy A07 slots `524294`–`524296`,
after the released Environment slot `524289` and Ordinal slots `524290`–`524293`.

`Array.BinarySearch(Array, object, IComparer)` uses that comparer without
allocating managed boxes for value-array elements. It returns a matching index
or the complemented insertion index in O(log n) comparisons and does not mutate
storage. The old and new overloads share one search loop. Comparison failures
become `InvalidOperationException` retaining the original managed InnerException;
array null/rank checks happen first. Empty arrays never invoke the comparer.
Unsupported custom comparers on nonempty arrays raise `NotSupportedException`.
One-dimensional arrays with explicit lower bounds remain unsupported by this
execution profile; multidimensional arrays raise `RankException`.

A null comparer uses the shared host-backed string profile described above.
Exact native invariant ordering is still outstanding in #829. The pinned 33-case .NET capture
under `reference/array-comparer` covers this actual non-generic overload and its
object comparisons/faults. Ordinary tests also consume the prior 97-string
ordinal search corpus. NaN comparisons and rank rejection are covered through
both managed platforms without claiming unsupported source syntax support.
Independent CIL fixtures execute every captured vector operation through the
non-generic interface, including boxing and opaque-object construction; typed
catches and the actual InnerException getter cover all three wrapped failures.
Compiled source covers eleven direct StringComparer operations. Registered
implicit interface conversions are supported; custom implementations, object
construction and NaN field access are not silently treated as successful
execution by the reference harness.

`scripts/benchmarks/a08-array-search.mjs` measures the released typed/default
BinarySearch and reports the new explicit ordinal path separately. Copy the same
runner to Ordinal baseline `640b96d3` and run both checkouts serially. Setup is
excluded; one warmup and five samples use deterministic nullable strings, hits
and complemented misses through each real VM platform. The typed/default path
still scans the full input for comparability, so its total cost remains O(n)
despite the shared logarithmic search loop. Managed allocation counts and bytes
are reported; this benchmark does not measure all host allocations.

The host `fault(type, message, reference = null)` service and public
`fail(platform, type, message, reference = null)` helper can carry an existing
managed exception reference. Callers root that reference during fault creation;
the runtime's ordinary exception frames retain it afterward. Existing calls
without a reference keep their previous behavior.
Compiled source supports direct `StringComparer.Ordinal.Compare` calls and
registry-proven implicit interface conversions, including `IComparer<string>`
locals, parameters and returns. These conversions keep the same managed reference
and dispatch through existing contracts. Interface `is` expressions, casts needing
runtime checks and custom comparer implementations remain guarded. Independently
assembled CIL exercises interface Compare, List.Sort, castclass and isinst without
bypassing runtime call or cast paths. Source-negative tests retain the remaining
guards; this does not enable arbitrary source interface implementations.
