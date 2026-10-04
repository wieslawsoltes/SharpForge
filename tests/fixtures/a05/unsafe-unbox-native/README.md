# SDK8 Unsafe.Unbox native captures

These three unmodified Roslyn DLLs come from the Project7 native Ubuntu SDK8 CI
run at `e09324d3e83d742d47eb39b8f0482c38dc0f8756`. The run used .NET SDK
8.0.425, `net8.0`, Linux x64 and Node 22.23.3. Native .NET executed each DLL
successfully and produced the existing fixture's exact expected output.

The same DLLs failed SharpForge admission because `Unsafe.Unbox<T>` was not
implemented. `capture.json` preserves that original failure alongside native
output, DLL hashes, and hashes of the unchanged source and expected-output files.
The fixture sources remain in the adjacent `value-boxing`, `value-instance-calls`
and `enum-unboxing` directories. No DLL was rebuilt or edited for the repair.

`tests/a05-unsafe-unbox-native-replay.test.js` verifies those hashes and replays
the captured binaries against the current runtime. Passing replay qualifies
those captured SDK8 bodies on the current Node runner; it does not claim a new
native SDK8 execution, SDK10 result, browser result or another OS result.
