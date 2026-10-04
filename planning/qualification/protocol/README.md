# Recorded client protocol conformance — SF-A29-T28 / #498

The harness, schema validators and VS Code recording extension are implemented.
**Actual VS Code recording coverage is not-run.** No installed `code` executable,
VS Code application or existing client recording was found during implementation.
The empty `recordings.json` registry retains that fact. Synthetic tooling tests
exercise real servers but are never relabelled as recordings.

Microsoft's complete LSP 3.17 metamodel and DAP JSON schema are retained under
`schema/`, with exact upstream commits, SHA-256 digests and original MIT license
notices. `loadModels` rejects changed schema bytes. The LSP validator supports all
kinds in the pinned model, including inherited/mixin structures and union/map
values. The DAP validator follows local schema references, allOf/oneOf, required
properties, enums, arrays/maps and integer bounds. Unknown successful requests
and unmodelled notifications/events fail; they are not silently schema-qualified.

The `DebugAdapter` error-response schema mismatch was fixed in Project 13 / A14,
SF-A14-T06.6 (#2860), by [PR #3448](https://github.com/wieslawsoltes/SharpForge/pull/3448).
Unsuccessful responses now include the empty `body` required by Microsoft's
pinned `ErrorResponse` schema. Seven focused protocol tests passed at implementation
commit `5788e4363eee9a6c54437a9871a176b11c3fdf7e`. The local synthetic
production-message probe also passed at final metadata-only follow-up
`800dcbe03684b19e99a5a75b2a235e6dd9627e27`, on darwin-arm64 with Node 24.21.0.
Those checks do not establish recorded-client interoperability or platform
qualification; the probe still reports `qualification: unknown`.
The retained historical clean-commit observation is
[observed/unsupported-darwin-arm64.json](observed/unsupported-darwin-arm64.json).
It records the earlier failing probe, not the post-fix result or qualification.
The standalone probe validates actual production responses and fails on schema
violations; focused tooling tests also check request/response correlation.
LSP unsupported requests must return JSON-RPC `-32601`. DAP defines unsuccessful
responses with a message and error body, not a universal numeric method-not-found
code. Recorded-client and cross-platform acceptance for #498 remain open.

```sh
node scripts/conformance/protocol/probe.js
node scripts/conformance/protocol/replay.js --registry planning/qualification/protocol/recordings.json
node scripts/conformance/protocol/replay.js path/to/reviewed-session.json
```

Replay launches the real stdio server, forwards the recorded client traffic in
order, validates every received response/event against the pinned model, checks
request/response identity and compares message content against the recording.
Only the DAP server's sequence counter is normalized. Changed payloads remain
reported differences. Runs have time, message and framing limits and dispose the
server process. Partial recordings and unreviewed synthetic sessions are rejected
by the CLI. An empty registry reports not-run, never pass.

## Reproducible VS Code capture

1. Use a clean checkout with Node 22+ and `npm ci --ignore-scripts` completed.
2. In `tests/conformance/protocol/vscode-client`, run `npm ci --ignore-scripts`
   using the checked-in lock. This installs the pinned Microsoft language client.
3. Launch VS Code with
   `code --extensionDevelopmentPath=/ABS/CHECKOUT/tests/conformance/protocol/vscode-client /ABS/SAMPLE-WORKSPACE`.
4. Set `sharpforgeConformance.root`, `.node` and `.output` to absolute paths for
   this checkout, the Node executable, and an ignored recording output directory.
5. For LSP, run **SharpForge: Start Recorded LSP Session**. Open/edit a C# sample;
   request hover, completion and rename; close the document and stop the extension
   host cleanly. The actual Microsoft language client sends those messages.
6. For DAP, create a launch configuration with `type: "sharpforge-conformance"`,
   `request: "launch"`, and `program` pointing to a managed sample assembly. Set a
   breakpoint, inspect stack/variables, step and disconnect. VS Code's real debug
   client drives the adapter through the same recorder.
7. Review the complete transcript from the controlled sample workspace. Copy it
   into `tests/conformance/protocol/recordings/`, and add its path and SHA-256 to
   `recordings.json`. Retain the recorder's client version, server commit and
   platform metadata. A copied or hand-edited transcript is not a fresh recording.
8. Replay using the commands above. Publish failed reports as failures; do not
   delete required fields from the upstream schema or approve mismatches away.

The proxy forwards protocol bytes unchanged, records decoded frames in both
directions, enforces a 32-MiB/10,000-message/30-minute limit, and requires terminal
protocol traffic before marking capture complete. Client identity is supplied by
the extension using `vscode.version`; it is provenance, not a cryptographic proof
of client authenticity. Failed or interrupted captures retain their incomplete
status and cannot qualify replay.

The manually dispatched `protocol-replay.yml` workflow always uploads replay and
production-probe reports. Schema violations still fail the probe. The initial
empty recording registry does not establish VS Code interoperability on any
platform. Keep #498 open pending actual recordings and staged platform
qualification.
