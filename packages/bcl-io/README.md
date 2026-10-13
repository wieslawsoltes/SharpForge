# @sharpforge/bcl-io

Dependency-free managed IO contributions built on the public `@sharpforge/bcl-core`
registry and host helpers. The package imports no framework or runtime implementation.
Framework/runtime hosts compose its modules through their existing registry seams.

The public entry point exports `stringReaderModule`, the frozen `ioModules` array,
and `registerIoModules(registry)`. Modules implement the core `{name, families,
contracts, invoke}` protocol. Registration requires the standard `define`, `member`
and `ctor` callbacks inside an active contract reservation. SharpForge registers
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

Pinned .NET 10.0.5 fixtures and focused tests cover both JavaScript VMs, including
ordinary CIL base dispatch and IDisposable assignability. Compiled `using` uses
the existing direct Dispose lowering. External `IDisposable.Dispose` invocation
itself remains outside the CIL profile; metadata does not add a second dispatch path.
Rust native/Wasm execution is not qualified by this batch.

Issue #2723 remains open: buffer/ReadBlock and async methods, TextReader.Null and
Synchronized, TextWriter/StringWriter, formatting/culture providers and Console
writers remain separate batches. These APIs are not registered; unsupported
source uses continue to fail compilation. User-defined TextReader subclasses are
not executable through this closed framework profile.
