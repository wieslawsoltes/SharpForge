# Bounded verifier dataflow qualification

Implementation-ready scope: decoded basic blocks, bounded deduplicated worklist,
changed-state reprocessing, handler seeds, leave clearing and integration with the
existing execution-profile height policy. Internal typed-state tests reuse the
existing verification lattice; they do not establish typed opcode verification.

Ten native PE cases are prepared for ILVerify: empty/balanced stacks, underflow,
maxstack overflow, mismatched join, diamond, loop, repeated switch targets, catch
and finally. The scheduled capture records the pinned SDK/runtime/tool and emitted
assembly hashes, complete stdout/stderr and parsed results. Captures and focused
checks have not run yet. No native, browser, speed or memory result is claimed.

The diagnostic spellings follow the pinned [ILVerify 10.0.5 catalog](https://raw.githubusercontent.com/dotnet/runtime/v10.0.5/src/coreclr/tools/ILVerification/VerifierError.cs).
Run `node tests/fixtures/verifier-dataflow/capture.mjs OUTPUT.json` only inside the
reserved serial validation slot. Existing no-handler/catch/finally admission
controls use `packages/cil/tools/benchmark-handler-entry.mjs` on the candidate and
its actual base, with all 12 chronological samples retained per control (first
three predetermined warmups). Broad platform/native/Wasm qualification stays open.
