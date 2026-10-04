# Retained Roslyn async and iterator assembly

`Qualification.dll` is the exact Release/net8.0 binary produced with SDK 8.0.425
by the native Ubuntu A05 CI job at revision
`e09324d3e83d742d47eb39b8f0482c38dc0f8756`. Its source is the parent `Program.cs`.
`qualification.json` is preserved unchanged: native .NET completed with the
expected output, while the VM failed admission. It records the actual commands,
source/assembly hashes, native stdout, and original VM diagnostics. The installed
runtime inventory does not establish which exact runtime patch executed.

The deterministic Node regression checks those hashes, resolves the generated
generic state-machine and iterator declarations, then compares full guest output
and both local/portable await replays with that retained native result. This does
not substitute for fresh SDK 8/10 and operating-system qualification.
