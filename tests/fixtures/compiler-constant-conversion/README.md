This fixture was compiled twice by pinned Roslyn 5.3.0 (SDK 10.0.201) and executed
twice on CoreCLR 10.0.5, with identical results. `oracle.json` records the compiler,
reference-assembly and source hashes, commands, host, assembly hash and output.

Unchecked floating constants outside Int32 range, including NaN and infinities,
fold to zero. The same values supplied as method parameters use the runtime
conversion: saturation to Int32 limits, with NaN converted to zero. Values are
truncated before the range check. Both SharpForge pipelines and both VMs replay
this observed distinction; a generic passing test is not native qualification.

Recapture with the exact installed oracle toolchain:

```sh
node tests/fixtures/compiler-constant-conversion/capture.mjs
```

During integration, `SHARPFORGE_ORACLE_ROOT` can point to the independently
qualified oracle worktree containing `scripts/conformance/oracle`. Ordinary Node
tests consume the retained evidence and do not require the native SDK.
