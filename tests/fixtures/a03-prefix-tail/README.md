# Tail lexical reference fixture

`input.js` authors a managed image through the existing fixture builder. Six
selected methods cover a valid tail and five invalid lexical patterns. The
entry point tail-calls an integer method returning 42. Capturing is explicit:

```sh
node scripts/limited.js node tests/fixtures/a03-prefix-tail/capture.mjs /tmp/a03-prefix-tail-native.json
```

The capture reuses pinned ILVerify/CoreCLR tooling and records tool, source,
image and reference hashes, raw verifier output and native process status.
Captures never implicitly rewrite tracked evidence. Set `SHARPFORGE_ILASM`,
`SHARPFORGE_ILVERIFY` and `SHARPFORGE_ORACLE_DOTNET` to the pinned tools described
in `tests/conformance/verifier/README.md`.

The retained capture at `d172277d` records SDK 10.0.201, ILVerify/CoreCLR 10.0.5
on macOS ARM64. All six lexical verdicts agree: the valid call passes; wrong
target, missing/intervening return, repeated tail and protected tail are rejected.
The real entry point returned exit code 42 without a signal. The protected case
also receives return-placement errors from ILVerify; only tail exclusion is the
scope of this API. The capture asserts the native result and retains failures.
Managed-pointer and call-signature checks remain open on #2410.
