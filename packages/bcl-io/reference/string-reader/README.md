# StringReader reference

Pinned SDK 10.0.201 and runtime 10.0.5, with roll-forward disabled. `Program.cs`
runs unchanged on both SharpForge engines. It covers CR/LF/CRLF, consecutive and
trailing separators, EOF, partial reads, UTF-16 surrogate code units, NUL, Unicode
characters that are not line separators, and repeated Close/Dispose.

`NativeProgram.cs` adds fault-type and TextReader/IDisposable observations. Its
reflection and delegate harness is native-only; independent CIL and platform
tests exercise those observations without broadening the source profile.

The root validation scheduler captures once from this directory, separating
build output from the oracle:

```sh
dotnet build StringReader.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/StringReader.dll > ../string-reader-net10.txt
```
