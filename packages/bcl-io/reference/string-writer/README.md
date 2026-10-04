# StringWriter reference

Run serially from this directory with pinned SDK 10.0.201/runtime 10.0.5:

```sh
dotnet run --project StringWriter.csproj --configuration Release --verbosity quiet > ../string-writer-net10.txt
```

Program.cs runs unchanged through both JavaScript VMs, including inherited TextWriter
disposal through `using (units)` in a method body. A separate regression covers
top-level `using` on both VMs. NativeProgram.cs adds
UTF-16 char writes, TextWriter base dispatch and faults; independent CIL and
managed-platform tests consume those results without requiring source Char or
interface/cast support. The capture uses the existing LF newline profile on
macOS; Windows default CRLF behavior is not claimed. Explicit NewLine values are
preserved exactly. Normal tests never launch the native toolchain.

The reference checks disposal retaining the StringBuilder, mutation through the
returned builder, custom/empty/reset newline, null writes, isolated surrogates,
idempotent Close/Dispose and Flush after disposal. Numeric/culture formatting,
buffer overloads, Encoding, Null writers and async APIs remain outside this batch.

Primary reference implementations:

- [StringWriter, .NET 10.0.5](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/IO/StringWriter.cs)
- [TextWriter, .NET 10.0.5](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/IO/TextWriter.cs)
