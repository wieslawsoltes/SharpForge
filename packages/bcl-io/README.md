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
writer buffer-line slots 655385–655386. Call `registerIoModules` for this canonical
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
combined-size precheck or transactional rollback. Existing WriteLine(string)
retains its original single disposal check before writing.

The new overloads reuse the bounded bulk conversion and builder append. Nonempty
buffer text and newline each create one managed text chunk, plus existing backing
growth when needed. No per-character managed strings are allocated. The separate
.NET 10.0.5 capture has 86 ordinary rows and eight native-only subclass observations
of the boundary between value and newline writes. Managed host-observer tests
reproduce that sequencing without claiming executable custom subclasses. Tests
also cover GC, snapshot restoration, input copying, newline failure and root cleanup.
The static `scripts/benchmarks/a09-string-writer-line-buffer.mjs` runner reports
existing string-line and separate buffer/newline controls alongside the two new
overloads. Copy it unchanged to baseline `31f92ab5`; setup and final text checks
are excluded, with one warmup, five samples and allocation/write counters.

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

Issue #2723 remains open: span/memory reader APIs, writer char/numeric/formatted WriteLine and async methods,
Null/Synchronized wrappers, numeric/formatting/culture overloads, Encoding, and Console
writer replacement remain separate batches. These APIs are not registered; unsupported
source uses continue to fail compilation. User-defined TextReader/TextWriter subclasses
are not executable through this closed framework profile.
