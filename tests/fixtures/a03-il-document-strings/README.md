# IL-document user-string native fixture

Three ordinary library methods retain an old numeric #US token or return a newly
added quoted literal. The Main edit inserts 300 NOPs into a loop, requiring both
forward and backward branch widening. The new literal includes quotes, URL //,
newline, non-ASCII/supplementary characters and NUL; Again shares its added token.

Captured with SDK 10.0.201 and .NET 10.0.5 on macOS ARM64. The native reader
executes all three methods: Main and Again return the exact new literal; Original
returns "old". The committed native.json is the actual runtime output.

From the repository root, run each command serially (dotnet must be on PATH):

```sh
node scripts/limited.js node tests/fixtures/a03-il-document-strings/prepare.js /tmp/a03-il-document-strings.dll
node scripts/limited.js dotnet build tests/fixtures/a03-il-document-strings/oracle/Strings.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-il-strings-obj/ -p:OutputPath=/tmp/a03-il-strings-bin/
node scripts/limited.js dotnet /tmp/a03-il-strings-bin/Strings.dll /tmp/a03-il-document-strings.dll
```

Standalone ilasm and Portable PDB editing are separate. The native oracle observes
ordinary CIL execution, not the source-VM profile invalidated by document edits.
