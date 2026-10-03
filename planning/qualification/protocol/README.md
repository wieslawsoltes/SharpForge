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

A current production mismatch remains open in Project 6 / A13:
`DebugAdapter` unsuccessful responses omit `body`, which Microsoft's pinned
`ErrorResponse` schema requires. The retained clean-commit observation is
[observed/unsupported-darwin-arm64.json](observed/unsupported-darwin-arm64.json).
It records a nonzero failing probe, not qualification. The standalone probe reports the actual message
and the schema failure; its process exits unsuccessfully. Tooling tests check that
this failure is detected. They do not count it as passing protocol qualification.
LSP unsupported requests must return JSON-RPC `-32601`. DAP defines unsuccessful
responses with a message and error body, not a universal numeric method-not-found
code. No product edits outside Project 4 are included here.

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

The manual/`full-ci` workflow always uploads replay and production-probe reports.
It intentionally fails while the DAP schema mismatch persists. The initial empty
recording registry does not establish VS Code interoperability on any platform.
Keep #498 open pending actual recordings, A13's product fix and staged platform
qualification.
