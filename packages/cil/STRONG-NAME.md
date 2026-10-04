# Public and delay signing

`compileToIL(source, { publicKey, publicSign: true })` emits the full public key in
Assembly metadata, sets `AssemblyFlags.PublicKey`, reserves a zero-filled signature,
and sets `CorFlags.StrongNameSigned`. `{ publicKey, delaySign: true }` reserves the same
space and leaves the CLI signed flag clear. The modes are mutually exclusive. The public
key must be a complete RSA/SHA-1 strong-name PUBLICKEYBLOB in a `Uint8Array`; supported
RSA modulus sizes are 512–16384 bits. The input is copied without modifying caller storage.

This implements identity and reservation only. It does not create or verify an RSA signature.
Private keys, key files, key containers and `signAssembly` produce an explicit unsupported
signing diagnostic. Other public-key algorithms and the special ECMA key are unsupported.
Unsigned emission is unchanged when all signing options are absent. Supplying a public key
without an explicit mode is rejected. Native loaders that require a valid cryptographic
signature can reject public-signed or delay-signed output.

The low-level `writePE` option `strongNameSignature: { offset, size, publicSign }` describes
zero-filled reserved bytes in the managed section. The reservation must be four-byte aligned,
between 64 and 2048 bytes, and cannot overlap metadata or managed resources. Metadata identity
is the caller's responsibility at this level. `readPE` already exposes the CLI signature directory.
Canonical source replay reconstructs the signing mode and public key from real metadata.

Semantics follow [.NET public signing](https://github.com/dotnet/runtime/blob/main/docs/project/public-signing.md)
and [C# delay signing](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/security).
Native reference evidence is tracked under `tests/fixtures/a03-public-sign`: .NET 10.0.5
AssemblyName and PEReader agree on public-key token, flags and zero reservation for all eight
mode/platform combinations. Both JavaScript engines pass. Browser, Windows loader, Mono
and signature-verification qualification remain outside this focused batch.
