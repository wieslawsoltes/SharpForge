# Public/delay-sign native reference

Captured sequentially on 2026-10-03 using .NET SDK 10.0.201/runtime 10.0.5, macOS ARM64. The public key is reused from the existing
.NET 10.0.5 System.Console identity fixture; no private key is used. `prepare.js` emits
public/delay-sign libraries for AnyCPU, x86, x64 and ARM64. The .NET 10 oracle uses
`AssemblyName.GetAssemblyName` and SRM `PEReader` to inspect token, flags and zero reservation.
No signature-verification, Windows loader or native execution claim is made by this fixture.

```sh
node tests/fixtures/a03-public-sign/prepare.js /tmp/a03-public-sign-input
/Users/wieslawsoltes/.dotnet/dotnet build tests/fixtures/a03-public-sign/oracle/PublicSign.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-public-sign-obj/ -p:OutputPath=/tmp/a03-public-sign-bin/
/Users/wieslawsoltes/.dotnet/dotnet /tmp/a03-public-sign-bin/PublicSign.dll /tmp/a03-public-sign-input/*.dll > tests/fixtures/a03-public-sign/native.json
```

Native observations: all eight libraries report public-key token `b03f5f7f11d50a3a`,
Assembly PublicKey flag, 128 zero signature bytes, and the expected public/delay-sign CLI flag.
The three-file focused run (public-sign, managed resources, determinism) passed 34/34 tests
through `scripts/limited.js` at test concurrency 1. Node 24.21.0 check passed 1635 syntax
modules and 1631 static modules, zero errors or unassigned tests. Structure reported only
existing findings, none in the changed files. No broad matrix or signature verification ran.
