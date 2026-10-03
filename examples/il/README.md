# Real IL examples

`Program.cs` compiles into a genuine managed PE/CLI DLL and prints `42` in SharpForge.

```sh
node apps/cli/main.js compile examples/il/Program.cs -o examples/il/artifacts/Example.dll
node apps/cli/main.js exec examples/il/artifacts/Example.dll
node apps/cli/main.js disasm examples/il/artifacts/Example.dll
```

The included artifacts also contain `NoSource.dll`: the same program without embedded source text, still directly loadable/executable in Studio. It proves source is not the executable payload. `NativeOnly.dll` omits the SharpForge profile stream: it is not loadable by the browser loader; use it for native-framework inspection/validation. A `.runtimeconfig.json` accompanies each net8 artifact. Full desktop .NET execution was not tested in this environment; see the validation report.

`Example.il.txt` is an inspection listing, not lossless ilasm input. The actual executable format is the binary `.dll`. No .NET runtime binaries are included.
