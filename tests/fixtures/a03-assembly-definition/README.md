# Assembly definition identity reference

Prepared, not yet validated. The .NET 10 oracle reads version/culture/name via
`AssemblyName.GetAssemblyName` for default, English, Japanese, maximum and zero versions.
No culture-sensitive execution, browser or broad native qualification is claimed.

```sh
node scripts/limited.js node tests/fixtures/a03-assembly-definition/prepare.js /tmp/a03-assembly-definition-input
/Users/wieslawsoltes/.dotnet/dotnet build tests/fixtures/a03-assembly-definition/oracle/Identity.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-definition-obj/ -p:OutputPath=/tmp/a03-definition-bin/
/Users/wieslawsoltes/.dotnet/dotnet /tmp/a03-definition-bin/Identity.dll /tmp/a03-assembly-definition-input/*.dll > tests/fixtures/a03-assembly-definition/native.json
```
