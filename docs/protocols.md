# Language and debug protocols — 0.9.0

`@sharpforge/protocol` ships reusable JSON handlers, bounded byte framing, and actual local Node stdio servers. This is a tested protocol subset, not a Visual Studio/VS Code extension or complete protocol implementation.

## Start a local server

```sh
node packages/protocol/bin/sharpforge-lsp.js
node packages/protocol/bin/sharpforge-dap.js
# Also installed as sharpforge-lsp and sharpforge-dap by the protocol tarball.
```

Stdout contains protocol frames only. Stderr is for host errors. Each UTF-8 JSON object has a `Content-Length: <byte count>\r\n\r\n` header. `ProtocolMessageReader` accepts split/coalesced byte input, validates framing/UTF-8/JSON envelopes, and fails closed until `reset()` after a malformed stream. Default body/header limits are 64 MiB/8192 bytes; the local host bounds pending messages to 1000. A single feed's buffered bytes also obey the total body/header limit. Transport EOF ends the session. Keep stdin open until the desired session completes.

`encodeProtocolMessage(message)` returns a Uint8Array. `new ProtocolMessageReader().feed(bytes)` returns complete messages; call `finish()` at EOF to reject truncation. The reader uses UTF-8 bytes; editor/LSP coordinates use UTF-16 code units. No network listener is opened.

## LSP subset

```js
import { LanguageServer } from '@sharpforge/protocol';
const server = new LanguageServer({ send: notification => transport.send(notification) });
const reply = await server.handle(incomingJsonRpcMessage);
if (reply) transport.send(reply);
```

Implemented: initialize/initialized, shutdown/exit, versioned document sync/diagnostics, completion, hover, definition, references, restricted rename/prepare-rename, highlights, symbols, folding/selection ranges, indentation formatting, versioned structural/type code actions, var inlay hints, signature help, full semantic tokens, source call hierarchy and reference code lenses. Property symbols use the property classification. Requests after shutdown fail; unsupported requests return method-not-found.

The stdio host serializes requests and cancels queued requests before synchronous dispatch when `$/cancelRequest` arrives. It does not preempt a running compilation. There is no complete workspace configuration, semantic-token delta, pull-diagnostic or process-level cancellation implementation. `sharpforge.showReferences` is a custom client command, not a shipped editor extension. Call hierarchy is revision-bound and excludes unsupported/external targets.

## DAP subset

After launch, configure breakpoints and send **configurationDone**. Execution waits for this barrier and defaults to run-to-breakpoint, not entry; set `stopOnEntry:true` explicitly for entry. Duplicate/out-of-phase configuration requests are rejected. Live breakpoint changes report binding events and stop events include hitBreakpointIds. Source and direct IL expose write-only storage descriptors and reverse Continue when history is enabled. Requests requiring a stop reject unconfigured/running state. Malformed replacement launches do not destroy the prior session. Unhandled managed faults report nonzero exit status.


```js
import { DebugAdapter } from '@sharpforge/protocol';
const adapter = new DebugAdapter({ send: event => transport.send(event) });
const reply = await adapter.handle(incomingRequest);
transport.send(reply);
adapter.pump({ instructionBudget: 15000, timeBudgetMs: 6 });
```

Source profile: `launch` accepts `assembly` (Uint8Array, ArrayBuffer, or byte-array JSON) or an explicitly restored legacy `image`. The strict canonical loader reads `#SF` source maps; it does not source-recompile the DLL.

Direct-CIL profile: set `managedIL: true`, `methodToken` (unique name, Type::Method or token) and optional `arguments`. This uses `CilDebugSession`, including ordinary DLLs without `#SF`. The **stdio host only** additionally accepts `program`, a file path of at most 64 MiB, defaults it to direct CIL, and reads it on the trusted host. The reusable adapter never fetches files or URLs itself. A DAP JSON launch example:

```json
{"seq":2,"type":"request","command":"launch","arguments":{"program":"/absolute/path/Arithmetic.dll","methodToken":"Add","arguments":[20,22],"stopOnEntry":true}}
```

Supported requests: initialize, launch/restart, configurationDone, source/function/instruction breakpoints, conditions/hit rules/logpoints, exception filters, one managed thread, continue/next/stepIn/stepOut/pause, source/direct-IL stepBack, reverseContinue, dataBreakpointInfo and setDataBreakpoints, stackTrace/scopes/variables/evaluate/local setVariable, direct disassemble, exceptionInfo/source, loadedSources, breakpointLocations, disconnect/terminate. Managed argument slots can also be edited as primitive variables before their use. References expire across resume, launch and stopped-state changes. Capabilities events reflect enabled history and expose disassembly/instruction breakpoints for direct sessions.

Instruction references are opaque `il:06000001:00000002` strings (MethodDef token and IL offset). The disassembler returns actual bytes/labels and bounded instruction windows. Source paths are absent when no source mapping exists. Ordinary DLLs do not gain reconstructed-source debugging. The debugger skips the resumed stop once, respects managed frame depth for next/out, and pauses exceptions before unwinding. Resume handles the saved fault exactly once.

No CLR/native process attach, restartFrame, memory read/write, async stacks, multiple execution threads, function evaluation, hot reload, Portable PDB debugging or full DAP conformance. Initialize negotiates linesStartAt1 and columnsStartAt1, including stopped frame and breakpoint range conversion. Reverse snapshots restore source-profile or opted-in direct-IL managed state only. Neither transport nor guest interpreter is an independently audited security sandbox.

## Evidence and references

`tests/release05-msil-protocol.test.js` spawns real stdio child processes, opens a disk DLL, observes debugger events and validates UTF-8/shutdown/framing. `tests/release05-debugger.test.js` validates direct adapter behavior. `scripts/verify-packages.js` also starts the installed tarball executables. External Visual Studio/VS Code interoperability is not qualified.

Normative references: Microsoft LSP 3.17 at https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ and Microsoft DAP at https://microsoft.github.io/debug-adapter-protocol/ . These references describe larger protocols than SharpForge implements.

## 0.6 managed IL reverse and storage requests

`stepBack`, `reverseContinue`, `dataBreakpointInfo` and `setDataBreakpoints` are implemented for direct IL sessions. A DAP launch enables recordHistory by default; set it false to opt out, or supply maxHistory/maxHistoryBytes bounds. Capabilities reflect history availability. Variable references expire after movement/restoration. Data IDs are session/frame/allocation-specific and only support write access. Reversing restores buffered program output, not previously delivered external output notifications; clients may clear/rebuild their display from refreshed state where appropriate. No external VS/VS Code interoperability qualification is implied by the local wire tests.
