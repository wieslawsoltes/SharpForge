# Signature reference corpus

`srm.json` contains more than 300 independent System.Reflection.Metadata
BlobEncoder cases plus signatures emitted by Roslyn for `RoslynFixture.cs`.
The fixture records the runtime, SRM version and SHA-256 of every generator input.
The checked-in corpus is consumed offline; tests never regenerate tracked files.

Reference: ECMA-335 sixth edition, II.23.2, and .NET 10.0.5 SRM. Regenerate with
SDK 10.0.201 into a temporary location, inspect the diff, then copy the output:

```sh
dotnet build tests/fixtures/signatures/SignatureOracle -c Release -m:1 \
  --disable-build-servers -p:BaseOutputPath=/tmp/signature-oracle/bin/ \
  -p:BaseIntermediateOutputPath=/tmp/signature-oracle/obj/
dotnet /tmp/signature-oracle/bin/Release/net10.0/SignatureOracle.dll \
  tests/fixtures/signatures/SignatureOracle > /tmp/signatures-srm.json
```

This qualifies binary signature shapes and bytes against a real native SRM
reader and writer. It does not qualify execution of the represented types on
the source VM, CIL interpreter, Rust engine or a browser CLR.
