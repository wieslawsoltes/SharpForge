# StringWriter string-line sequencing reference

This independent fixture targets SDK 10.0.201 and CoreCLR 10.0.5, with invariant
current culture and UI culture. It prepares 144 ordinary StringWriter rows and
36 separate native-only subclass transition observations. The integration owner
built and ran it on Linux x64 with that pinned SDK/runtime. The retained capture
is `../string-writer-string-line-net10.json`, with SHA-256
`61bb501df12b86a5682ccd3aeeaaba497dfde74745231bcc293e99395129b05e`.
Its captured Program.cs SHA-256 is
`c2e7a66aa4059fa4b1a61a6d2edd347592f06a12f92bc2452bcb89a349025717`.
All expected rows come from that execution, independently of SharpForge.

The ordinary rows call exact `WriteLine(string)` and control `Write(string)`
overloads through concrete StringWriter and TextWriter references. They cover
null, empty, ordinary and surrogate-containing values; open, disposed and null
receivers; and default, empty, custom, null-reset and UTF-16 newlines. Output and
NewLine use UTF-16 unit arrays, with null preserved. The initial buffer is `seed|`.
These rows establish initial null/disposal precedence independently of callbacks.

The capture confirms that initially disposed writers fault for null and empty
string values even when NewLine is empty; null receivers fault first. A completed
payload followed by callback disposal retains the payload and faults before its
newline. A null string instead has only its newline write, so callback disposal
after that completed write succeeds. NewLine mutation after a payload affects
the pending newline; the same mutation after a null string's newline affects
future writes. Callback throws preserve the completed payload or newline.

Native-only `TransitionWriter` rows override `Write(string)` and observe its first
completed base write, then change NewLine, dispose the writer, or throw. The rows
include a null value, for which the first completed write is the newline itself.
They record individual write entry/completion/fault events, parameterless line
calls, output, newline state and disposal state. Initially disposed cases record
whether the first virtual string write was entered before its disposal fault.
These are native sequencing observations, not evidence that SharpForge executes
user-defined TextWriter/StringWriter subclasses. Separate managed host-observer
tests can reproduce the boundary after a nonempty completed append.

The exact .NET `v10.0.5` source establishes why the correction is required:

- [TextWriter.cs](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/IO/TextWriter.cs#L452-L459),
  blob `035664cc815f5e70e478413e3efbe4c9407deae9`, implements string-line writes
  by conditionally writing a non-null value, then writing its current newline
  through a second virtual string write.
- [StringWriter.cs](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/IO/StringWriter.cs#L126-L139),
  blob `478d95fd347ac47198fc5341e606aba7d62eb19c`, checks disposal on every
  string write and does not override the inherited string-line overload.

The prior assertion that a callback could dispose the writer after the text and
still allow its newline encoded a defect. Correcting it must retain completed
text and the actual ordinary null/empty disposal behavior captured here.

## Scheduled capture

Use the installed pinned SDK/runtime during the integration owner's serial lane,
from the repository root:

```sh
cd packages/bcl-io/reference/string-writer-string-line
node ../../../../scripts/limited.js dotnet build StringWriterStringLine.csproj --configuration Release --verbosity quiet
node ../../../../scripts/limited.js dotnet bin/Release/net10.0/StringWriterStringLine.dll ../string-writer-string-line-net10.json
```

The JSON records runtime, architecture, host newline, exact source SHA-256 and
the inspected native source blobs. Use cleared package sources for an offline
framework restore when required. Preserve the earlier scalar source and captured
JSON byte-for-byte; this correction has its own source and capture. Native
execution alone does not qualify source/CIL parity, managed heap behavior,
Windows-default newline behavior, custom subclasses or native/Wasm execution.
