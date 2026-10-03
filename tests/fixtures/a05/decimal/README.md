# Decimal native reference

`native-reference.json` copies the original source and output captured in assembled
A05 E01 commit4fa8e838, .NET SDK10.0.201/runtime10.0.5, macOS arm64, invariant
culture. SHA-256 values bind the original source and output; no expected output was
computed from the JavaScript implementation.

`Program.cs` is the same source with a trailing newline for convenient reuse. To
regenerate under an allocated serial validation slot, place it in a net10.0 console
project, set DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 and run `dotnet run -c Release`.
Record SDK/runtime/platform and output hashes before replacing the reference. Other
platforms are pending qualification. Both source engines should consume this source
once the paired T01.8 frontend integration lands; the current CIL test assembles
its own metadata and compares the arithmetic observations to the saved output.
