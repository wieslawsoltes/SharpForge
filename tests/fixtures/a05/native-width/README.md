# Native integer width qualification — #1347

The exact same C# input observes `IntPtr.Size`/`UIntPtr.Size`, native/int mixed
arithmetic, width-dependent shift masking, signed overflow/underflow, unsigned
overflow, checked conversion and native-width array/byref storage. `expected.txt`
is the authored 64-bit trace; `expected-32.txt` is the authored 32-bit trace.
Neither expected file is a recorded native result.

The existing six native matrix cells execute this fixture with `--source-routes`.
A separate, serial Windows x86 matrix installs SDK 8.0.425 and 10.0.201 into
isolated directories and executes only this fixture. It does not run the large
numeric corpus or infer width from the Node process. The independent native probe
uses the fixture's actual runtime configuration and records `IntPtr.Size`,
`RuntimeInformation.ProcessArchitecture`, framework description and runtime
version. The same observed pointer width configures both the actual Roslyn DLL's
CIL execution and the source/reload/compiler-CIL comparisons against native output.

The x86 final proof rejects any process other than X86 with 32-bit pointers, any
SDK mismatch, an unsuccessful native result, or any omitted/different VM route.
It retains a failure report when setup or execution did not complete. Runtime
configuration, source, compiler-produced assembly and probe hashes are recorded;
installation metadata also retains the official installer, SDK compiler, dotnet
host and installed CoreCLR hashes. Both width claims remain pending until their
actual workflow reports pass. A VM configured to 32 bits compared to a 64-bit CLR
is not accepted as 32-bit native qualification.

The installation inputs were checked against primary sources on 2026-10-04:

- [Microsoft's .NET 8 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/8.0)
  publish SDK 8.0.425 Windows x86 binaries.
- [Microsoft's .NET 10 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/10.0)
  publish SDK 10.0.201 Windows x86 binaries.
- [The official installer reference](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-install-script)
  documents the CI use case, exact `-Version`, `-Architecture x86`, `-InstallDir`
  and `-NoPath` inputs.
- The repository's pinned [setup-dotnet v4 action](https://github.com/actions/setup-dotnet/blob/67a3573c9a986a3f9c594539f4ab511d57bb3ce9/action.yml)
  has no architecture input. The additional job therefore runs its
  [bundled official installer](https://github.com/actions/setup-dotnet/blob/67a3573c9a986a3f9c594539f4ab511d57bb3ce9/externals/install-dotnet.ps1)
  only after validating SHA256
  `7e9969069558023daf52bbf6fc55eb37032eb23c7ff55a7d6afc659d54d6c23b`.
  No installer or SDK payload is committed to the product repository.

Local authored-trace/proof-guard regression:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-native-width-qualification.test.js
```

This JavaScript-only command cannot establish native parity. With an actual
Windows x86 SDK selected, the explicit native command is:

```sh
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/native-width --source-routes --expected tests/fixtures/a05/native-width/expected-32.txt --framework net10.0 --dotnet /path/to/x86/dotnet.exe --output artifacts/a05-native-width
node scripts/a05/verify-native-width.js artifacts/a05-native-width 32 10.0.201
```
