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

`String.Compare(string, int, string, int, int, StringComparison)` is appended at
A07 slot `524304`, after the mode-aware affix overloads. `Ordinal` and
`OrdinalIgnoreCase` compare independently clipped ranges without allocating
substrings, folded strings or range objects. Invalid enum values are checked
first; supported modes then order nulls before range validation. Non-null inputs
validate length, negative indices and past-end indices before zero-length or
same-range shortcuts. High surrogates pair only within each range's own end, and
ranges beginning at a low surrogate do not read before their start. Only the
comparison sign is specified.

Culture modes 0–3 explicitly raise `NotSupportedException` before null, invalid
range or identity shortcuts. The [292-row native reference](reference/string-compare-comparison-ranges/README.md)
retains the actual .NET 10.0.5 / SDK 10.0.201 culture results and faults separately
from this deliberate profile restriction. Tests cover both pipelines/VMs,
independent CIL, all captured precedence/boundary cases, GC-rooted inputs and
unchanged raw results/faults for the released 58-case CompareOrdinal range oracle.
The original whole-string and affix loops remain unchanged.

Comparison takes O(n) time in inspected UTF-16 units and constant auxiliary space.
The identical bounded `scripts/benchmarks/a07-string-compare-comparison-ranges.mjs`
runner on baseline `2a1c6007` and the candidate reports existing range and whole
comparison controls separately from new overload costs, using one warmup and five
samples per VM, median/p95 and managed allocation counters. #2621 remains open for
culture support and remaining APIs; Boolean/culture overloads are outside this
batch.

`String.Contains(string, StringComparison)` appends at A07 slot `524305` after
range Compare. It supports `Ordinal` and `OrdinalIgnoreCase`. The released
one-argument Contains contract `1258` is unchanged. A null receiver faults first;
a null value precedes comparison-mode validation. Invalid enum values raise
`ArgumentException`, and culture modes 0–3 explicitly raise `NotSupportedException`
before empty, identity or length shortcuts. Native culture results remain intact
in the [194-row reference](reference/string-contains-comparison/README.md).

Ordinal delegates to the existing UTF-16 string search. Ignore-case search uses
the private Two-Way implementation described below, with the same pinned fold as
the bounded affix matcher. It can match a needle whose start or end splits a
surrogate pair without constructing substrings, folded copies or a search table.

Tests cover both compiler pipelines/source+CIL VMs, independently assembled CIL,
the unchanged .NET 10.0.5 / SDK 10.0.201 oracle, surrogate boundaries, input
preservation and managed allocation counters. The static benchmark
`scripts/benchmarks/a07-string-contains-comparison.mjs` runs unchanged on baseline
`1a9105df` and the candidate, separating released one-argument controls from new
mode costs. It reports ordinary paths and bounded ASCII/Unicode repeated-prefix
misses/late hits, with one warmup, five samples, median/p95 and managed allocations.
No speedup is claimed. IndexOf, range searches and culture modes remain outside
this slice; #2621 remains open.

`String.IndexOf(string, StringComparison)` is appended at A07 slot `524306` after
Contains `524305`. It returns the first matching UTF-16 unit offset, zero for an
empty value, or -1 when absent. Ordinal uses the native JavaScript UTF-16 search;
OrdinalIgnoreCase reuses the bounded search from Contains, including matches
starting or ending inside surrogate pairs. Contains now tests that shared offset
for nonnegativity, preserving its faults and mode-specific diagnostic text.

The runtime selects this overload by its registered enum parameter, keeping the
released same-arity `IndexOf(string, int)` start-index behavior and IDs unchanged.
Null receivers fail first; null values raise `ArgumentNullException` naming
`value` before invalid modes. Invalid enum values raise `ArgumentException` naming
`comparisonType`; valid culture modes 0–3 explicitly raise `NotSupportedException`
before empty/identity shortcuts. Start/count comparison overloads and culture
implementation remain outside this batch; #2621 remains open.

The [218-row .NET 10.0.5 reference](reference/string-indexof-comparison/README.md)
retains exact native offsets, Contains results, faults and native culture controls.
Tests cover both pipelines/VMs, independent CIL, int-versus-enum overload binding,
first/overlapping matches, supplementary prefixes, malformed UTF-16, GC and zero
managed allocation. The shared ignore-case search now uses O(n+m) time and
constant auxiliary space, retaining the same offsets and faults. The bounded
`scripts/benchmarks/a07-string-indexof-comparison.mjs` runner
compares identical workloads against parent `080ec4ed`, with released IndexOf and
Contains controls, ordinary input and 1024-unit repeated-prefix misses/late hits
using 64-unit needles. One warmup and five samples per VM report median/p95 and
managed allocation counters; setup and result checks are excluded.

The performance follow-up replaces only the shared ordinal-ignore-case search.
`src/system/string-search-linear.js` independently implements the
[Crochemore–Perrin Two-Way algorithm](https://doi.org/10.1145/116825.116845), using
two maximal-suffix passes to select a critical cut and period. It stores a
constant number of counters plus two small host records when factorization is used. It
does not allocate managed objects, transformed strings, failure arrays or shift
tables; **constant space does not mean allocation-free host execution**. The
existing comparison/affix loops and the original pinned fold remain unchanged.

The reduction to fixed symbols is essential for UTF-16 correctness:

1. The virtual folded-unit view uses the original whole string. Valid surrogate
   pairs map through the shared ordinal scalar fold, exposing their resulting
   high and low units at the original offsets. Isolated units remain isolated.
   The pinned mapping preserves UTF-16 width and surrogate categories.
2. Only a needle's first low surrogate and last high surrogate can pair outside
   a candidate window. Those optional units become raw endpoint predicates; the
   remaining core is searched through the fixed folded-unit view. A successful
   raw predicate also prevents the adjacent core unit from pairing across that
   boundary. An empty core contains at most two raw units and uses a simple scan.
3. Two-Way searches valid full-needle start positions in order, comparing the
   right core half and then the left. Periodic overlap memory survives a full core
   match whose raw endpoint fails. Restarting search there would lose the linear
   bound. The returned core offset subtracts the excluded leading unit.

For a nonempty core with a leading low surrogate, one initial raw scan now skips
positions that cannot satisfy that required endpoint. It begins at the validated
start index and stops at the last full-needle window, using the original low unit
even when it belongs to a source pair whose scalar folds differently. If no raw
prefix exists, it returns before factorization or folding. Otherwise Two-Way
starts at the first possible window with zero overlap memory; all later endpoint
checks and period transitions stay unchanged for both first and last searches.
This adds at most one O(n) scan and constant counters. It never restarts the scan
for a rejected core, and leaves empty/raw-only needles on their existing paths.

This gives O(n+m) folded-unit accesses for receiver length n and needle length m,
plus O(1) endpoint work per considered alignment. Each unit access uses bounded
lookaround and the fixed pinned mapping table. Needles of at most eight UTF-16
units use the unchanged bounded candidate matcher instead of factorization. That
fixed O(8n) path remains linear and avoids the two factor records. Initial serial
measurements found that always factoring short needles regressed the ordinary
5,000-call sample by 25–41% (about 1.1–1.2 ms to 1.4–1.6 ms), motivating this cutoff.
Tests count actual source/needle code-unit reads,
including period preprocessing, for repeated-prefix and rejected periodic-core
matches while n and m grow together. Exhaustive small inputs, longer differential
cases and both unchanged native search oracles guard boundary and overlap behavior.
The exhaustive cases also invoke Two-Way directly, independent of the cutoff;
eight/nine-unit controls exercise dispatch, both compiler pipelines and direct CIL.
Separate read counters assert that missing raw prefixes do not inspect the core
or scan outside the eligible start range. Offset controls cover prefixes before
the lower bound, after the last full window, within a surrogate pair, and before
later successful or rejected periodic matches.

`scripts/benchmarks/a07-string-search-linear.mjs` runs unchanged on the current
prefix-filter baseline `72547446` and candidate. It retains the measured ordinary,
repeated-prefix and raw endpoint rejection inputs, adds prefix-present/window-end
controls, and includes start-index and LastIndexOf timings. Both source/CIL platforms report
median/p95 and managed allocation counters after one warmup and five samples;
setup, optional host GC and assertions are excluded. Host allocation counts and
other globalization profiles are not claimed. The original runner against
`40cf1975` measured the initial Two-Way implementation and reduced the
20-call Unicode repeated-prefix samples from about 80–83 ms to 1.0–1.1 ms and ASCII
samples from 6–7 ms to 0.15–0.33 ms. The periodic leading-endpoint-miss workload was
8–11% slower, a disclosed constant-factor tradeoff. These are measurements of the
initial Two-Way candidate, before the short-needle cutoff; final candidate timings
and qualification are recorded by the serial validation owner.

`String.LastIndexOf(string, StringComparison)` is appended at A07 slot `524307`
after IndexOf `524306`. It returns the last matching UTF-16 unit offset, -1 for a
miss, and `receiver.Length` for an empty value (including zero for an empty
receiver). Ordinal uses the JavaScript UTF-16 last search. OrdinalIgnoreCase uses
one continuing Two-Way scan: each accepted match updates the last offset and
retains period memory, including overlaps and later raw-endpoint rejection.
First-search callers still return immediately on their first accepted match.

Receiver/value null checks and comparison-mode validation precede empty/identity
shortcuts. Invalid enum values name `comparisonType`; modes 0–3 explicitly raise
`NotSupportedException` after null-value checking. The released single-string
LastIndexOf contract and all prior IDs are unchanged. Start/count overloads and
culture support remain outside this batch; #2621 stays open.

The [246-row pinned .NET reference](reference/string-lastindexof-comparison/README.md)
retains exact last offsets alongside native first-offset/Contains results, faults,
UTF-16 inputs and culture controls. Tests cover both source pipelines/VMs,
independent CIL, supplementary and malformed UTF-16, empty-at-end behavior,
periodic endpoint rejection before/after valid hits, GC and managed allocations.
Exhaustive short inputs compare the last bounded match, while counted-access
controls ensure that finding all periodic overlaps does not restart the search.
The continuing helper remains O(n+m) time/O(1) auxiliary space; its two constant
factorization records are host allocations, with no per-unit or managed text
allocation.

The bounded `scripts/benchmarks/a07-string-lastindexof-comparison.mjs` runner
compares identical baseline/candidate workloads with released LastIndexOf,
IndexOf and Contains controls. New last-search costs are separate. One warmup and
five samples cover ordinary inputs plus 1024-unit repeated-prefix misses, late
hits and all overlapping matches with 64-unit needles, reporting median/p95 and
managed allocation counts outside setup and result checks.

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

`StringBuilder.Append(char)` and `Append(char, int)` preserve individual UTF-16
units, return the same builder, and append one managed chunk per nonzero call.
Zero repeats perform no writes or managed allocations. Invalid repeat counts
and growth beyond `Int32.MaxValue` fail with `ArgumentOutOfRangeException`
identifying `repeatCount`; this check precedes the separate host allocation cap.
The two contracts append at A07 IDs 524309–524310. The pinned .NET 10.0.5
reference covers 37 character, null, repeat and capacity-boundary cases;
focused source/CIL tests additionally cover GC, snapshots and host allocation
faults. Existing chunk capacity growth and write-observer partial progress are
preserved; exact native capacity transitions and remaining StringBuilder
overloads stay tracked in #2636 and #2637. Repeat expansion costs O(count) time
and temporary text, bounded by the host limit, with one chunk append afterward.

The StringBuilder `Chars` indexer reads and writes one UTF-16 unit through native
`get_Chars(int)` / `set_Chars(int, char)` signatures at IDs 524312–524313. Registered
`defaultMember: 'Chars'` metadata enables source bracket syntax without aliases.
Reads scan existing chunks with no managed allocations; writes replace only the
affected string chunk, preserving backing storage, count, length and capacity.
The displaced and replacement chunks remain rooted during write notifications.
Getter bounds throw `IndexOutOfRangeException`; setter bounds throw
`ArgumentOutOfRangeException` naming `index`, matching 44 pinned .NET 10.0.5 cases.
The managed observer may see partial progress: a thrown array observer leaves
the replacement installed and the heap revision updated, before the normal
builder-version notification. Reentrant Clear/Append changes are retained.
Reads cost O(chunk count); writes cost O(chunk count + affected chunk length).
The generated reference inventory still reports indexed-property metadata rows
separately from the implemented accessor signatures.

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

`String.IndexOf(string, int startIndex, StringComparison)` appends A07 contract
`524308` and searches the suffix beginning at an inclusive UTF-16 offset. The
result is an absolute offset in the original receiver, or -1. Start indices from
zero through `Length` are valid; an empty value returns `startIndex`, including
`Length`. The released one-argument, int-start and comparison-mode overloads keep
their contract IDs and behavior.

Receiver/value null checks precede enum validation; an invalid enum wins over an
invalid start. A valid enum then requires a start within `0..Length`. Culture
modes 0–3 remain explicitly unsupported after those checks, including on empty
and identical strings. The [pinned .NET 10.0.5 capture](reference/string-indexof-comparison-start/README.md)
retains 832 native results and faults, including actual culture outcomes rather
than substituting the profile guard into the reference.

Both first-search routes share the existing <=8-unit bounded candidate path and
Two-Way helper. Searches begin at the absolute start offset without substring,
folded-string, options-object or per-call closure allocation. Raw surrogate
endpoints retain candidate-boundary semantics even when `startIndex` splits a
pair; the full-input folded accessor and LastIndexOf continuation remain shared.
For an eligible suffix of n units and a value of m units, the ignore-case path
uses O(n + m) folded reads and O(1) auxiliary space. Long nonempty folded cores
still use two constant-size host factorization records; successful calls do not
allocate managed strings or arrays.

The focused tests cover both compiler pipelines and VMs, independent CIL,
managed collection, every start in an exhaustive small UTF-16 corpus, direct
Two-Way paths and counted reads after an excluded prefix. The static benchmark
`scripts/benchmarks/a07-string-indexof-comparison-start.mjs` compares unchanged
first/last/int-start controls against parent `b679f98d`, then reports the new
ordinal and ignore-case overloads separately, with 8/9/64-unit repeated needles.
Count overloads and culture implementations remain separate work under #2621;
native/Wasm execution is not qualified by this batch.

`String.IndexOf(string, int startIndex, int count, StringComparison)` appends
contract `524311` after the character StringBuilder Append contracts `524309` and
`524310`. It searches the half-open UTF-16 window `[startIndex, startIndex + count)`
and returns an absolute offset, or -1. Empty values return `startIndex` even for
zero-count/end windows. Receiver/value null, invalid enum, invalid start and
invalid count retain that precedence; valid culture modes reach the explicit
unsupported guard only after all argument checks. All prior IDs remain fixed.

The [pinned .NET 10.0.5 fixture](reference/string-indexof-comparison-window/README.md)
contains 988 unchanged native rows, with full-window controls, null/range faults,
empty windows, every window in a small UTF-16 corpus, surrogate cuts at both bounds
and periodic searches with hits inside/outside the window. Actual culture results
remain in the oracle; modes 0–3 are not implemented by this partial profile.

Ordinal-ignore-case reuses the bounded <=8-unit scan and fixed-fold Two-Way core,
including the raw leading-low prescan. The last eligible candidate is derived
from the exclusive window end. The full-input fold and raw endpoint checks retain
pair-cut semantics without substring copies, new policy objects or per-call
closures. Surrogate classification may inspect an immediately adjacent unit
outside the window; no candidate can extend outside it. This route uses
O(count + value.Length) folded reads and constant
auxiliary space, retaining two host factorization records for eligible long cores.
Ordinal uses the existing host `indexOf` and rejects a first match outside the
window. It may inspect the excluded suffix and is bounded by the total receiver
length plus value length, rather than the window size; this deliberate reuse
avoids a new ordinal algorithm or indirect accessor in released ignore-case loops.
Both routes avoid managed allocation on successful calls.

Tests cover both compiler pipelines and VMs, independent CIL, collection safety,
exhaustive windows, the new ordered ABI tail and counted ignore-case reads with
large excluded prefixes/suffixes. The static benchmark
`scripts/benchmarks/a07-string-indexof-comparison-window.mjs` compares released
first/last/int-start controls against combined parent `57bc331b` and reports the
new bounded overload separately. The parent includes builder contracts and the
raw-prefix optimization so their effects are not attributed to this overload.
Culture support and other search overloads remain tracked by #2621; this batch
does not qualify native/Wasm execution.

`String.LastIndexOf(string, int startIndex, StringComparison)` appends contract
`524314` after the StringBuilder indexer accessors `524312`/`524313`. The start
index is the last UTF-16 unit included in the searched prefix. A nonempty receiver
accepts `0..Length`; `Length` aliases the final unit. An empty receiver accepts
both -1 and 0. The normalized exclusive end is `min(startIndex + 1, Length)`;
empty values return that end. Null receiver/value, invalid enum and invalid start
retain native precedence before the explicit guard for culture modes 0–3.

The [pinned .NET 10.0.5 capture](reference/string-lastindexof-comparison-start/README.md)
contains 990 unchanged native rows, including the 246 whole-string controls,
empty-receiver aliases, inclusive endpoints, every small prefix, overlapping
matches, surrogate cuts and periodic clipped matches. Valid culture outputs
remain in the oracle even though the profile deliberately rejects those modes.

Ordinal limits its native `lastIndexOf` starting position to the final complete
candidate (`end - value.Length`) after empty/length checks. Ordinal-ignore-case
reuses the existing continuing Two-Way scan with the exclusive end; it retains
period memory after matches and rejected raw endpoints. No substring, transformed
copy, options object or callback is introduced. Both return absolute offsets;
no candidate can cross the prefix end. The ignore-case fold can inspect adjacent
surrogate units outside the prefix for classification, as in the existing window
search. Its read bound is O(prefix.Length + value.Length), with constant space
and two host factorization records for eligible nonempty folded cores. Successful
calls allocate no managed strings or arrays.

Tests cover both compiler pipelines and VMs, independent CIL, managed collection,
exhaustive prefixes, empty/end normalization and counted overlap reads. The static
benchmark `scripts/benchmarks/a07-string-lastindexof-comparison-start.mjs` compares
unchanged first/last controls against merged indexer parent `1fe6e268`, then reports
the new ordinal and ignore-case prefix routes separately. It includes 8/9/64-unit
needles, excluded suffixes and all-overlap inputs. Other LastIndexOf overloads,
culture support and native/Wasm execution remain outside this batch under #2621.

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
