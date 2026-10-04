# Symbol-server key reference

`keys.json` records actual HTTP request keys emitted by the pinned NuGet
`dotnet-symbol` 8.0.532401 tool. The capture serves only an isolated loopback
endpoint returning 404; it supplies an explicit temporary cache/output directory
and never uses the public symbol server. The tool DLL SHA-256 and each input
SHA-256 are recorded alongside the observations. The ordinary tests are offline
and do not regenerate the fixture.

The generated managed PE tests timestamp casing and its Portable PDB CodeView
lookup. The existing Microsoft `Documents.pdb` fixture, copied under a Greek
uppercase name, tests standalone PDB identity lookup and invariant simple casing.
Input metadata is parsed by the real dotnet-symbol tool; tests compare the product
keys against the observed request paths.

Explicit regeneration (native execution; use the shared validation queue):

```sh
SF_DOTNET_SYMBOL=/path/to/dotnet-symbol.dll DOTNET_PATH=/path/to/dotnet \
  node scripts/validate-symbol-server.mjs --output tests/fixtures/symbol-server/keys.json
```

The external reference package is tooling only and is not a product dependency.
NuGet package SHA-256:
`b2af08b9c1998cdf1f6605efd1f2b5b8632d3a0c6224bfd748647a25b1c2ca34`.
The capture rejects a DLL that does not match the pinned tool hash.
