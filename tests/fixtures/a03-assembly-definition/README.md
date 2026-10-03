# Assembly definition identity reference

Captured serially on 2026-10-04 using .NET SDK 10.0.201/runtime 10.0.5 on macOS ARM64. The .NET 10 oracle reads version/culture/name via
`AssemblyName.GetAssemblyName` for default, English, Japanese, maximum and zero versions.
No culture-sensitive execution, browser or broad native qualification is claimed.

```sh
node scripts/limited.js node tests/fixtures/a03-assembly-definition/prepare.js /tmp/a03-assembly-definition-input
/Users/wieslawsoltes/.dotnet/dotnet build tests/fixtures/a03-assembly-definition/oracle/Identity.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-definition-obj/ -p:OutputPath=/tmp/a03-definition-bin/
/Users/wieslawsoltes/.dotnet/dotnet /tmp/a03-definition-bin/Identity.dll /tmp/a03-assembly-definition-input/*.dll > tests/fixtures/a03-assembly-definition/native.json
```

All five native identities matched. The focused identity/public-sign/manifest-row/row-writer
run passed 23/23 through the limiter at concurrency 1. Node 24.21.0 check passed 1740 syntax
and 1736 static modules with zero errors/unassigned tests. Structure reported no findings
in this batch's own files. No broad matrix was run. Existing metadata/emitter files shrink
by extracting initialization and name/profile validation into focused modules.
