# Virtual dispatch reference fixture

`Program.cs` is the Roslyn/native counterpart of `tests/a05-b03-dispatch.test.js`.
Its expected output is `1\n3\n3\n7\n`.

Run from the repository root with Node 22+ and an installed .NET SDK:

```sh
DOTNET_PATH=/path/to/dotnet node scripts/validate-a05-dispatch.js
```

The runner builds the unmodified C# source in a temporary directory with cleared
NuGet package sources, then executes that **same DLL** in .NET and directly in
`CilVirtualMachine`. It also checks that Roslyn emitted the expected newslot,
reuse-slot, and explicit MethodImpl metadata. The target framework defaults to
the installed SDK major version; `DOTNET_TARGET_FRAMEWORK` can select another
installed target. `--output directory` selects the artifact directory.

The default `artifacts/a05-dispatch/` output contains the compiled DLL, runtime
configuration, and a JSON report with the source and assembly SHA-256 hashes,
source revision, native and VM results, tool versions, and executed commands.
`qualification.json` here records the successful macOS arm64 run on Node
24.21.0 and .NET SDK 10.0.201 / runtime 10.0.5. Other native hosts and browser
execution are not qualified by that report.

The JavaScript fixtures additionally cover explicit class `MethodImpl` rows,
MemberRef call sites, malformed implementations, nonvirtual hiding, and final
slots. Those independent CIL metadata fixtures are not native qualification.

Contract: ECMA-335 sixth edition, II.10.3 (newslot and overrides), II.22.27
(MethodImpl), and III.4.2 (callvirt), available in the
[official specification](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
