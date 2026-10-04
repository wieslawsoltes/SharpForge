# StringReader reference

Pinned SDK 10.0.201 and runtime 10.0.5, with roll-forward disabled. `Program.cs`
runs unchanged on both SharpForge engines. It covers CR/LF/CRLF, consecutive and
trailing separators, EOF, partial reads, UTF-16 surrogate code units, NUL, Unicode
characters that are not line separators, and repeated Close/Dispose.

`NativeProgram.cs` adds fault-type and TextReader/IDisposable observations. Its
reflection and delegate harness is native-only; independent CIL and platform
tests exercise those observations without broadening the source profile.

The committed `../string-reader-net10.txt` capture has 45 lines: 35 unchanged
program observations, a section separator, and nine native fault/base-type
observations. These include the individual UTF-16 surrogate values, EOF after
the trailing newline, ArgumentNullException, NullReferenceException, and
ObjectDisposedException even when the disposed reader was already empty.

The root validation scheduler captures once from this directory, separating
build output from the oracle:

```sh
dotnet build StringReader.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/StringReader.dll > ../string-reader-net10.txt
```
