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
appends reader buffer slots 655381–655382 and writer buffer slots 655383–655384. Call `registerIoModules` for this canonical
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

The builder remains available and mutable after disposal, while every Write/WriteLine
throws ObjectDisposedException, including null/empty writes. Flush and NewLine remain
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

Issue #2723 remains open: span/memory reader APIs, writer WriteLine buffer overloads and async methods,
Null/Synchronized wrappers, numeric/formatting/culture overloads, Encoding, and Console
writer replacement remain separate batches. These APIs are not registered; unsupported
source uses continue to fail compilation. User-defined TextReader/TextWriter subclasses
are not executable through this closed framework profile.
