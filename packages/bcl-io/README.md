# @sharpforge/bcl-io

Dependency-free managed IO contributions built on the public `@sharpforge/bcl-core`
registry and host helpers. The package imports no framework or runtime implementation.
Framework/runtime hosts compose its modules through their existing registry seams.

The public entry point exports `stringReaderModule`, `stringWriterModule`, the frozen `ioModules` array,
and `registerIoModules(registry)`. Modules implement the core `{name, families,
contracts, invoke}` protocol. Registration requires the standard `define`, `member`,
`ctor` and `prop` callbacks inside an active contract reservation. SharpForge registers
these contracts after JSON GetInt64 in A09, retaining all released IDs.
Registration order is part of the ABI: the `bcl-io` base group registers reader
slots 655361–655367 and writer slots 655368–655380, then the `extensions` group
appends reader buffer slots 655381–655382, writer buffer slots 655383–655384 and
writer buffer-line slots 655385–655386, character-line slot 655387, scalar Write slots
655388–655395 and scalar WriteLine slots 655396–655403. Call `registerIoModules` for this canonical
order; standalone core registration of a module still includes its own extension hook.

This batch provides abstract TextReader metadata and StringReader construction,
Peek, parameterless Read, ReadLine, ReadToEnd, Close and Dispose. Read/Peek return
one UTF-16 code unit as an integer, or -1. ReadLine consumes CR, LF or CRLF and
returns null at EOF; ReadToEnd returns an empty string at EOF. Null construction
throws ArgumentNullException, and reads after disposal throw ObjectDisposedException.

The source reference, cursor and disposal flag live entirely in managed heap
fields. GC traverses the source normally, disposal releases it, and snapshots
restore the original cursor and live/disposed state. Read/Peek use constant time
and allocate no managed values. ReadLine/ReadToEnd scan/copy only their returned
text and use the existing managed heap budget. Output is rooted across write
notifications; allocation failure leaves the cursor unchanged.

`Read(char[], index, count)` and `ReadBlock(char[], index, count)` copy UTF-16 units
into the existing buffer and return the count copied, or zero at EOF. They share
the StringReader cursor; ReadBlock fills the requested slice unless input ends.
Buffer/range validation precedes disposal checks, including zero-length reads.
Null buffers raise ArgumentNullException, negative indices/counts raise
ArgumentOutOfRangeException, and slices outside the buffer raise ArgumentException.
Valid slices on disposed readers raise ObjectDisposedException.

Copying costs O(units read), uses constant temporary root storage, and allocates no
managed values. Each written array slot uses the ordinary write observer; the
cursor commits after copying. Observer failures can leave completed buffer writes
visible with the original cursor, and temporary roots are always released. GC and
snapshots preserve both the buffer and reader state. The separate 56-row .NET
capture executes as source bytecode and independently assembled CIL. Bound and legacy
source character-array calls have separate coverage on both VMs.

StringWriter adds default and StringBuilder constructors, NewLine, Write(char/string),
WriteLine()/WriteLine(string), Flush, Close, Dispose, GetStringBuilder and ToString.
Its TextWriter base is abstract. The writer holds the ordinary managed StringBuilder
and calls its existing module through the public core registry; storage, growth,
notifications and the 1,000,000 UTF-16-unit text bound are shared. Appending costs
the input length plus the builder's existing amortized chunk growth; ToString
materializes the current buffer. No second buffer or private core import is used.

`WriteLine(string)` writes a non-null value, then checks disposal again before
writing the current NewLine. A callback that disposes the writer after its text
append leaves that text visible and prevents the newline, including an empty
newline. Changing NewLine at that boundary changes the newline that is written.
A null string skips the value append: its only write is the newline, so disposal
after that completed newline does not introduce another fault. Null/empty string
calls on initially disposed writers still fault, and null receivers fault first.
The earlier one-check assertion encoded a defect and is corrected by the separate
`reference/string-writer-string-line` capture: 144 ordinary rows and 36 native-only
subclass observations, with exact UTF-16, source/runtime and callback provenance.
Both platform adapters, independent CIL and bound/legacy source regressions cover
the captured behavior. Managed host-observer tests qualify the append boundary;
they do not claim executable writer subclasses.

StringWriter's existing parameterless ToString contract (ID 655380) explicitly opts
in to Object.ToString dispatch. An `object` reference therefore returns the current
builder text, including after disposal or an external builder mutation. Source,
compiled CIL and profile round trips use the shared framework override service;
ordinary CIL `callvirt` selects the override while nonvirtual `call` retains
`System.IO.StringWriter`. Both instructions fault on null. The separate ten-row
.NET 10.0.5 capture under `reference/string-writer-object` pins these cases.
No new contract, runtime dispatcher or formatting path is added. Convert and
Console retain their existing object formatting profiles.

`Write(char[])` and `Write(char[], index, count)` append a copied UTF-16 buffer
through either StringWriter or TextWriter. A null whole-array argument does
nothing, including after disposal. The slice overload validates the buffer,
index, count and slice bounds before checking disposal; valid empty slices still
fault on a disposed writer. Null receiver checks precede both overloads. Shared
SZ char-array validation also serves StringReader without changing its behavior.

Bulk conversion takes O(count) time and O(count) temporary host text, using at
most 4096 code units per spread operation. Each nonempty write calls the existing
StringBuilder append once: one managed text chunk, plus backing growth when
needed. It preserves NUL and isolated surrogates, leaves the input untouched and
does not retain the caller array. The shared 1,000,000-unit text bound is checked
before conversion, and managed OOM preserves the previous text. Existing builder
write notifications, rooting and snapshot behavior apply. Throwing host observers
can interrupt builder field updates; this is not a transactional rollback API.

The seventy-row .NET 10.0.5 buffer capture checks concrete/base calls, null, range,
disposal and UTF-16 boundaries through real source bytecode and independent CIL.
Bound and legacy source character-array calls have separate coverage on both VMs.
Native parameter names document precedence, but ArgumentException.ParamName is
not added. `scripts/benchmarks/a09-string-writer-buffer.mjs` reports existing
string/character controls and new buffer paths separately, with setup excluded,
one warmup, five samples and managed allocation/write counts. Copy the identical
runner to baseline `b0521bbd`; unavailable buffer paths are explicitly skipped.

`WriteLine(char[])` and `WriteLine(char[], index, count)` first perform the same
buffer write, then check disposal again and append the current NewLine separately.
A null whole-array buffer still writes a newline; it faults after disposal even
when NewLine is empty. Slice buffer/range validation still precedes disposal.
NewLine changes during the completed buffer append are observed by the newline
step. Disposal at that boundary faults while retaining the buffer text. A newline
allocation or host-limit failure also retains the completed buffer; there is no
combined-size precheck or transactional rollback. String-line writes observe the
same disposal boundary described above.

The new overloads reuse the bounded bulk conversion and builder append. Nonempty
buffer text and newline each create one managed text chunk, plus existing backing
growth when needed. No per-character managed strings are allocated. The separate
.NET 10.0.5 capture has 86 ordinary rows and eight native-only subclass observations
of the boundary between value and newline writes. Managed host-observer tests
reproduce that sequencing without claiming executable custom subclasses. Tests
also cover GC, snapshot restoration, input copying, newline failure and root cleanup.
The static `scripts/benchmarks/a09-string-writer-line-buffer.mjs` runner reports
existing string-line and separate buffer/newline controls alongside the two new
overloads. Copy the buffer-line revision unchanged to baseline `31f92ab5`; setup and final text checks
are excluded, with one warmup, five samples and allocation/write counters.

`WriteLine(char)` appends one UTF-16 code unit using the existing Write(char)
conversion and builder append, then rechecks disposal and appends the current
NewLine. NUL and isolated surrogates remain exact code units. Null receivers and
disposed writers fault before character validation or progress; a callback that
disposes the writer after the character append prevents the newline while keeping
the completed character. NewLine changes at that boundary are observed.
Write(char) remains a single value write.

Character append work is constant plus the existing builder growth; newline work
scales with NewLine length. A character and nonempty newline use two managed text
chunks. Allocation and host-limit failures preserve completed progress, and
throwing observers retain the existing nontransactional behavior. Forty ordinary
.NET 10.0.5 rows and four native-only transition rows accompany source/CIL,
compiled concrete/base, GC, snapshot and fault tests. The line benchmark also
reports separate Write(char)+WriteLine() and new WriteLine(char) paths; copy the
current runner unchanged to character-line baseline `1ff8cd7b`.

`Write` and `WriteLine` also accept `bool`, `int`, `uint`, `long`, `ulong`, `float`,
`double`, and `decimal`, in that contract order. Each value uses the existing typed
`StringBuilder.Append` contract through a cached descriptor. UInt32/UInt64 retain
their unsigned widths, Int64 avoids conversion through a JavaScript Number, Single
uses its own shortest default representation, Double retains special values and
negative zero, and Decimal preserves its 96-bit coefficient and trailing scale.
The Boolean strings are `True` and `False`. Narrow integer arguments use ordinary
compiler widening to Int32; character and string retain distinct overload selection.

Scalar `WriteLine` first completes typed Write, then checks disposal again and
appends the current NewLine. Changing NewLine during the completed value append is
observed. Disposal at that point faults while preserving the value, and a throwing
observer prevents the newline step. Existing StringBuilder growth, managed roots,
snapshots and the UTF-16 text limit apply. A nonempty scalar write produces one
managed text chunk; a nonempty newline produces a second chunk. No descriptor or
format-provider object is allocated per invocation. Conversion cost follows the
existing typed default formatter; newline work scales with NewLine length.

The scalar tests reuse named, pinned .NET 10.0.5 StringBuilder and Double formatting
captures for scalar text, keeping their original provenance. Independent CIL emits
I4/I8 bits and exact Decimal words; bound and legacy source tests check all sixteen
contracts on both JavaScript VMs. An independent native writer fixture under
`reference/string-writer-scalars` has 312 captured ordinary rows and 24 native-only
transition observations, consumed by source-platform and independent CIL tests.
Its exact source/runtime provenance is recorded there. These overloads implement the existing invariant formatting and LF
execution profile. Culture/provider constructors, custom formatters, object and
composite-format overloads, and native/Wasm execution remain outside this batch.
Scheduled qualification at scalar product revision `f8414bfc` passed 278 integrated
tests. The bounded runner at `benchmarks/string-writer-scalars.mjs` measured 27
released controls on each JavaScript platform against integrated #4517
(`726fbd830`), with both revisions sharing the merged compiler/runtime prerequisites.
The comparison used fresh ABBA processes, 256 calls, 256 input units, one excluded
warmup and five retained samples per process. New scalar costs were captured
separately because those overloads are absent from the baseline.

All measured allocation, allocated-byte and slot-write counts matched on existing
controls. After removing repeated dispatch checks, 15 of 54 median comparisons
still exceeded the 5% timing budget. The remaining exceptions and observed tails
received explicit independent agent review; their causes are not fully attributed.
The complete qualification and retained before/after samples are recorded in
[PR #4542](https://github.com/wieslawsoltes/SharpForge/pull/4542). These direct
platform-call measurements do not establish interpreter throughput, managed GC
counts, host allocation volume, or native/Wasm execution parity. The adjacent
benchmark README gives the serial commands and exact provenance checks.

The builder remains available and mutable after disposal. String/character writes
and every WriteLine throw ObjectDisposedException, including null/empty values;
the full-buffer Write(null) exception is described above. Flush and NewLine remain
usable after disposal. WriteLine writes the value and newline separately, preserving
partial progress if appending the newline exceeds the host bound. All writer state
lives in managed fields and survives snapshots and observer-triggered collections.
The execution profile defaults to LF, and setting NewLine to null resets LF. Explicit
newlines preserve all UTF-16 units. OS-specific defaults and culture providers are
not supplied by this batch; Windows-default CRLF parity is not claimed.

Pinned .NET 10.0.5 fixtures and focused tests cover both JavaScript VMs, including
ordinary CIL base dispatch and IDisposable assignability. The writer's captured native
source runs unchanged, including semantic method-body `using` with inherited TextWriter
Dispose. Top-level `using` has separate coverage through the existing direct Dispose
lowering. Write(char) has bound/legacy source coverage on both VMs plus independent
CIL and platform coverage. External `IDisposable.Dispose` invocation
itself remains outside the CIL profile; metadata does not add a second dispatch path.
Rust native/Wasm execution is not qualified by this batch.

Issue #2723 remains open: span/memory reader APIs, object/composite-formatted writer and async methods,
Null/Synchronized wrappers, format/culture providers, Encoding, and Console
writer replacement remain separate batches. These APIs are not registered; unsupported
source uses continue to fail compilation. User-defined TextReader/TextWriter subclasses
are not executable through this closed framework profile.
