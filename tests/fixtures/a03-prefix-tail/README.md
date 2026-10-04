# Tail lexical reference fixture

`input.js` authors a managed image through the existing fixture builder. Six
selected methods cover a valid tail and five invalid lexical patterns. The
entry point tail-calls an integer method returning 42. Capturing is explicit:

```sh
node scripts/limited.js node tests/fixtures/a03-prefix-tail/capture.mjs /tmp/a03-prefix-tail-native.json
```

The capture reuses pinned ILVerify/CoreCLR tooling and records tool, source,
image and reference hashes, raw verifier output and native process status.
Captures never implicitly rewrite tracked evidence. Native output and tests
remain pending until the scheduled serial slot; an authored generator is not
qualification evidence. Managed-pointer and call-signature checks remain #2410.
