# @sharpforge/bcl-io

Dependency-free managed IO contributions built on the public `@sharpforge/bcl-core`
registry and host helpers. The package imports no framework or runtime implementation.
Framework/runtime hosts compose its modules through their existing registry seams.

The public entry point exports `stringReaderModule`, `stringWriterModule`, the frozen `ioModules` array,
and `registerIoModules(registry)`. Modules implement the core `{name, families,
contracts, invoke}` protocol. Registration requires the standard `define`, `member`,
`ctor` and `prop` callbacks inside an active contract reservation. SharpForge registers
these contracts after JSON GetInt64 in A09, retaining all released IDs.

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

StringWriter adds default and StringBuilder constructors, NewLine, Write(char/string),
WriteLine()/WriteLine(string), Flush, Close, Dispose, GetStringBuilder and ToString.
Its TextWriter base is abstract. The writer holds the ordinary managed StringBuilder
and calls its existing module through the public core registry; storage, growth,
notifications and the 1,000,000 UTF-16-unit text bound are shared. Appending costs
the input length plus the builder's existing amortized chunk growth; ToString
materializes the current buffer. No second buffer or private core import is used.

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

Issue #2723 remains open: reader/writer buffer overloads, ReadBlock and async methods,
Null/Synchronized wrappers, numeric/formatting/culture overloads, Encoding, and Console
writer replacement remain separate batches. These APIs are not registered; unsupported
source uses continue to fail compilation. User-defined TextReader/TextWriter subclasses
are not executable through this closed framework profile.
