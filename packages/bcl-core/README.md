# BCL core

This package owns BCL family contracts and managed implementations. It has no
runtime or framework dependency. Hosts supply `bclHost.fault(type, message)`,
`bclHost.isReference(value)` and `bclHost.frameworkType(name)` on each platform.
The fault service must throw the host's managed exception.

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

A null comparer retains the released ordinal default string profile. Default
invariant ordering is still outstanding in #829. The pinned 33-case .NET capture
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
