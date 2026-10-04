# StringWriter character-buffer line reference

Pinned SDK 10.0.201/runtime 10.0.5 capture full-array and slice WriteLine calls
through StringWriter and TextWriter views. The 86 ordinary rows retain UTF-16
input/output, null/range/disposal faults and native parameter names. Default,
empty, custom, null-reset and surrogate-containing newlines are included.

Eight native-only subclass rows observe NewLine mutation or disposal after the
buffer write and before the newline write. Managed tests reproduce this boundary
with host write observers; they do not claim custom TextWriter subclass support.
Host allocation bounds, GC and observer exceptions are separate managed controls.
Native parameter names record precedence; this batch does not add ParamName.

```sh
dotnet build WriterLineBuffer.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/WriterLineBuffer.dll ../string-writer-line-buffer-net10.json
```

Root captures once with build output separate from JSON. Tests consume the frozen
snapshot without executing native code. Default/null-reset captures use the
capture host's LF convention; Windows default CRLF parity is not claimed.
