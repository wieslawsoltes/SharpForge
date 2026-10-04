Pinned `StringBuilder.Insert(int,char)` evidence on SDK 10.0.201/runtime 10.0.5.
The program rejects other runtime versions and captures its exact source SHA-256.
Raw UTF-16 is serialized as numeric unit arrays, including surrogate cuts and NUL.
Cases cover null/empty/chunked receivers, insertion endpoints, Int32 bounds, alias
reads evaluated before mutation, capacity growth and returned receiver identity.
Native chunk/capacity metadata is retained without asserting that the existing
SharpForge flattening/capacity profile matches the native rope architecture.

Root serial capture, from this directory:

```sh
dotnet build -c Release --nologo
dotnet bin/Release/net10.0/StringBuilderInsertChar.dll ../string-builder-insert-char-net10.json
```

Ordinary regression tests use the frozen JSON and do not run .NET. No generated
snapshot is supplied before the root-owned native capture.
