# Public/delay-sign native reference

Prepared for a queued, serial validation run. The public key is reused from the existing
.NET 10.0.5 System.Console identity fixture; no private key is used. `prepare.js` emits
public/delay-sign libraries for AnyCPU, x86, x64 and ARM64. The .NET 10 oracle uses
`AssemblyName.GetAssemblyName` and SRM `PEReader` to inspect token, flags and zero reservation.
No signature-verification, Windows loader or native execution claim is made by this fixture.

```sh
node tests/fixtures/a03-public-sign/prepare.js /tmp/a03-public-sign-input
/Users/wieslawsoltes/.dotnet/dotnet build tests/fixtures/a03-public-sign/oracle/PublicSign.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-public-sign-obj/ -p:OutputPath=/tmp/a03-public-sign-bin/
/Users/wieslawsoltes/.dotnet/dotnet /tmp/a03-public-sign-bin/PublicSign.dll /tmp/a03-public-sign-input/*.dll > tests/fixtures/a03-public-sign/native.json
```
