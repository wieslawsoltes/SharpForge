# StringWriter scalar reference

This independent fixture targets SDK 10.0.201 and CoreCLR 10.0.5. It pins the
current culture and UI culture to invariant culture and calls the eight typed
`TextWriter.Write` and `TextWriter.WriteLine` overloads on concrete `StringWriter`
instances: `bool`, `int`, `uint`, `long`, `ulong`, `float`, `double`, and `decimal`.
The calls use typed pattern variables; they do not select the `object` overload.

The integration owner built and ran this fixture on Linux x64 with SDK 10.0.201
and CoreCLR 10.0.5. The retained `../string-writer-scalars-net10.json` contains
312 ordinary rows and 24 native-only transition rows. Its SHA-256 is
`ca02ecd8569682d18180e0b1c51f4efb09f861a09dc355accd4310dffeb2d21e`;
the captured Program.cs SHA-256 is
`2a9b8bcb46891606d84ba65655942516ba2cb3584c9de1dead9c7c922cc9f013`.
SharpForge execution is covered by the separate focused tests; a successful
reference capture does not itself qualify those engines. Existing StringBuilder
snapshots retain their own API provenance and are consumed separately.

## Coverage and output

Ordinary rows cover both operations, signed/unsigned 32-bit and 64-bit bounds,
integers beyond JavaScript's exact-number range, both floating-point zeros,
subnormal/normal boundaries, finite extrema, NaN and infinities, decimal trailing
scale, signed scaled zero, minimum nonzero magnitude, and decimal extrema.
Representative cases cover null and disposed receivers and default, LF, CRLF,
empty, custom, null-reset, and surrogate-containing newlines.

JSON records runtime/SDK, invariant culture, the fixture source SHA-256, the
declared and concrete receiver types, and the host's newline as UTF-16 units.
Input descriptions preserve integers as strings, Single/Double values as exact
IEEE bit patterns, and Decimal values as all four `decimal.GetBits` words.
Outputs and newline values use UTF-16 code-unit arrays, preserving NUL and
unpaired surrogates. The initial buffer is `seed|`; fault rows retain any completed
output. Null receiver output is null. Exception type names are recorded without
localized messages.

The native-only `transitions` rows override `Write(string)` after its completed
base write. For each scalar type, they change `NewLine`, dispose the writer, or
throw from that callback. A separate parameterless `WriteLine()` override records
whether the newline stage was entered and completed. These are native behavioral
observations for SharpForge host-observer tests; they do not qualify custom
TextWriter/StringWriter subclass execution in SharpForge. Managed heap limits,
GC roots, snapshots, observer exceptions, and native/Wasm backend qualification
remain separate controls.

## Verified source contract

The .NET `v10.0.5` sources were read through the GitHub file API:

- [TextWriter.cs](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/IO/TextWriter.cs),
  blob `035664cc815f5e70e478413e3efbe4c9407deae9`: each scalar `WriteLine(T)`
  invokes virtual `Write(T)` before virtual parameterless `WriteLine()`.
  Numeric `Write(T)` uses `ToString(FormatProvider)` and virtual `Write(string)`;
  Boolean writes its corresponding standard Boolean text through `Write(string)`.
- [StringWriter.cs](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/IO/StringWriter.cs),
  blob `478d95fd347ac47198fc5341e606aba7d62eb19c`: scalar overloads are inherited;
  string and array-slice writes each check whether the writer is open before
  appending to its builder.

These source paths establish the intended sequencing, independently of the
retained runtime capture. Completed scalar text precedes the callback; a later
newline change affects the newline stage, disposal is encountered by that stage,
and a callback exception prevents entering it.

## Capture commands

Run once during the scheduled reference qualification slot, with SDK 10.0.201
and runtime 10.0.5 already installed, starting at the repository root:

```sh
cd packages/bcl-io/reference/string-writer-scalars
node ../../../../scripts/limited.js dotnet build StringWriterScalars.csproj --configuration Release --verbosity quiet
node ../../../../scripts/limited.js dotnet bin/Release/net10.0/StringWriterScalars.dll ../string-writer-scalars-net10.json
```

Build output is separate from the JSON file. Review any recapture and its source
hash before replacing the retained snapshot. The captured build used an explicit
NuGet configuration with cleared package sources for an offline framework restore.
Default and null-reset newlines follow `Environment.NewLine`; the explicit
newline rows are portable. An LF-host capture does not establish Windows default
CRLF behavior, arbitrary culture/provider support, or native/Wasm qualification.
