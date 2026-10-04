# StringWriter character-line reference

Pinned SDK 10.0.201/runtime 10.0.5 capture `WriteLine(char)` through StringWriter
and TextWriter views. Forty ordinary rows retain exact UTF-16 output and faults:
NUL/CR/LF/ASCII, surrogate boundaries, disposed/null receivers and default, empty,
custom, null-reset and surrogate-containing newlines.

Four native-only subclass rows observe NewLine mutation or disposal after the
character write. Managed tests reproduce that boundary with host observers;
custom TextWriter subclass execution remains outside the managed profile.
Managed allocation limits, GC and observer failures are separate controls.

```sh
dotnet build WriterCharLine.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/WriterCharLine.dll ../string-writer-char-line-net10.json
```

Root captures once with build output separate from JSON. Tests consume the frozen
snapshot. Default/null-reset rows use the capture host's LF convention; Windows
default CRLF parity is not claimed.
