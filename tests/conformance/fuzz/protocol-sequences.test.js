import test from 'node:test';
import assert from 'node:assert/strict';
import { target } from '../../../scripts/conformance/fuzz/targets/protocol.js';
import {
  createProtocolSequenceSeeds, isProtocolSequence, protocolSequenceSeed, runProtocolSequence,
} from '../../../scripts/conformance/fuzz/targets/protocol-sequence.js';
import { createLspSequence, lspSequenceOperations as lsp } from '../../../scripts/conformance/fuzz/targets/protocol-sequence-lsp.js';
import { createDapSequence, dapSequenceOperations as dap } from '../../../scripts/conformance/fuzz/targets/protocol-sequence-dap.js';
import {
  checkDapResponse, checkLspResponse, ProtocolSequenceOutput,
} from '../../../scripts/conformance/fuzz/targets/protocol-sequence-messages.js';

const context = { maxInputBytes: 64 * 1024, maxOutputBytes: 64 * 1024 };
const encode = source => new TextEncoder().encode(source);
const input = (protocol, operations) => protocolSequenceSeed('test', protocol, operations).input;
const accepted = protocol => ({ status: 'accepted', code: 'PROTOCOL_' + protocol.toUpperCase() + '_SEQUENCE' });

test('protocol sequences: seeds are deterministic and the byte prefix preserves existing framing mode', () => {
  const first = createProtocolSequenceSeeds(), second = createProtocolSequenceSeeds();
  assert.deepEqual(first, second);
  assert.equal(isProtocolSequence(encode('Content-Length: 2\r\n\r\n{}')), false);
  assert.equal(isProtocolSequence(null), false);
  for (let index = 0; index < first.length; index++) {
    assert.ok(isProtocolSequence(first[index].input));
    assert.notEqual(first[index].input.buffer, second[index].input.buffer);
    assert.ok(first[index].input.length < 64);
  }
});

test('protocol sequences: shipped cases exercise actual handlers and controlled negative responses', async () => {
  for (const seed of createProtocolSequenceSeeds()) {
    const result = await target.run(seed.input, context);
    assert.deepEqual(result, accepted(seed.name.startsWith('lsp-') ? 'lsp' : 'dap'), seed.name);
  }
});

test('LSP sequences: edits, queries, close and shutdown preserve protocol state and correlation', async () => {
  const operations = [lsp.initialize, lsp.initialized, lsp.open, lsp.openSecond, lsp.change,
    lsp.hover, lsp.completion, lsp.symbols, lsp.semanticTokens, lsp.selection, lsp.folding,
    lsp.formatting, lsp.workspaceSymbols, lsp.cancel, lsp.close, lsp.shutdown, lsp.hover];
  assert.deepEqual(await runProtocolSequence(input('lsp', operations), context), accepted('lsp'));
});

test('LSP sequences: owned source variants include diagnostic-producing text without growing document state', async () => {
  const operationCount = Object.keys(lsp).length;
  const operations = [lsp.initialize, lsp.open + 2 * operationCount, lsp.semanticTokens,
    lsp.change + operationCount, lsp.symbols, lsp.close];
  assert.deepEqual(await runProtocolSequence(input('lsp', operations), context), accepted('lsp'));
});

test('DAP sequences: fixed IL launch, stepping, bounded inspection, restart and disposal work in memory', async () => {
  const operations = [dap.initialize, dap.breakpoints, dap.instructionBreakpoints, dap.exceptions,
    dap.launch, dap.configure, dap.stack, dap.scopes, dap.variables, dap.evaluate, dap.disassemble,
    dap.next, dap.continue, dap.loadedSources, dap.restart, dap.stack, dap.terminate];
  assert.deepEqual(await runProtocolSequence(input('dap', operations), context), accepted('dap'));
});

test('DAP sequences: missing state and malformed owned argument shapes produce explicit error responses', async () => {
  const operations = [dap.configure, dap.continue, dap.next, dap.stack, dap.scopes, dap.variables,
    dap.disassemble, dap.expiredVariables, dap.badBreakpoints, dap.unknown];
  assert.deepEqual(await runProtocolSequence(input('dap', operations), context), accepted('dap'));
});

test('DAP sequences: the current null-envelope product defect is surfaced as a finding, never a rejected input', async () => {
  await assert.rejects(runProtocolSequence(input('dap', [dap.nullEnvelope]), context), error =>
    error instanceof TypeError && /null/.test(error.message));
});

test('protocol sequences: caught native exceptions from malformed parameters remain findings', async () => {
  for (const operation of [lsp.nullParameters, lsp.missingDocument]) {
    await assert.rejects(runProtocolSequence(input('lsp', [operation]), context), /Unexpected LSP error response/);
  }
  await assert.rejects(runProtocolSequence(input('dap', [dap.nullArguments]), context), /Unexpected DAP error response/);
});

test('protocol sequences: only precise owned diagnostics qualify as expected negative responses', () => {
  const lspDriver = createLspSequence(new ProtocolSequenceOutput('lsp', context), context);
  const dapDriver = createDapSequence(new ProtocolSequenceOutput('dap', context), context);
  try {
    const step = lspDriver.step(lsp.formatting + Object.keys(lsp).length, 1);
    checkLspResponse(step, { jsonrpc: '2.0', id: 1,
      error: { code: -32602, message: 'tabSize must be between 1 and 16' } });
    for (const message of ['Unexpected internal exception', "Cannot read properties of null (reading 'options')"]) {
      assert.throws(() => checkLspResponse(step, { jsonrpc: '2.0', id: 1,
        error: { code: -32602, message } }), /Unexpected LSP error response/);
    }
    const dapStep = dapDriver.step(dap.badBreakpoints, 1);
    checkDapResponse(dapStep, { seq: 1, type: 'response', request_seq: 1, command: 'setBreakpoints',
      success: false, message: 'Breakpoint source path is required' });
    assert.throws(() => checkDapResponse(dapStep, { seq: 1, type: 'response', request_seq: 1, command: 'setBreakpoints',
      success: false, message: "Cannot read properties of null (reading 'source')" }), /Unexpected DAP error response/);
    const malformedStep = dapDriver.step(dap.nullArguments, 2);
    assert.throws(() => checkDapResponse(malformedStep, { seq: 2, type: 'response', request_seq: 2, command: 'initialize',
      success: false, message: "Cannot read properties of null (reading 'linesStartAt1')" }), /Unexpected DAP error response/);
  } finally {
    lspDriver.dispose();
    dapDriver.dispose();
  }
});

test('protocol sequences: unknown profiles, empty programs and excessive operation counts remain bounded', async () => {
  assert.deepEqual(runProtocolSequence(encode('sequence:other\n\0'), context), {
    status: 'unsupported', code: 'PROTOCOL_SEQUENCE_PROFILE_UNSUPPORTED',
  });
  assert.deepEqual(runProtocolSequence(encode('sequence:lsp\n'), context), {
    status: 'rejected', code: 'PROTOCOL_SEQUENCE_COUNT',
  });
  const header = encode('sequence:dap\n'), excessive = new Uint8Array(header.length + 33);
  excessive.set(header);
  assert.deepEqual(runProtocolSequence(excessive, context), { status: 'rejected', code: 'PROTOCOL_SEQUENCE_COUNT' });
  assert.deepEqual(await runProtocolSequence(input('dap', Array(32).fill(dap.threads)), context), accepted('dap'));
});

test('protocol sequences: byte and output caps are enforced before growing a transcript', async () => {
  const source = input('lsp', [lsp.initialize]);
  assert.deepEqual(runProtocolSequence(source, { ...context, maxInputBytes: source.length - 1 }), {
    status: 'rejected', code: 'FUZZ_INPUT_LIMIT',
  });
  for (const [protocol, operation] of [['lsp', lsp.initialize], ['dap', dap.initialize]]) {
    assert.deepEqual(await runProtocolSequence(input(protocol, [operation]), { ...context, maxOutputBytes: 16 }), {
      status: 'rejected', code: 'FUZZ_OUTPUT_LIMIT',
    });
  }
});

test('protocol sequences: cancellation propagates before and between awaited handlers', async () => {
  const controller = new AbortController(), reason = new Error('Sequence cancelled');
  const pending = runProtocolSequence(input('lsp', [lsp.initialize, lsp.open]), { ...context, signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.throws(() => runProtocolSequence(input('dap', [dap.initialize]), { ...context, signal: controller.signal }), error => error === reason);
});

test('protocol sequences: malformed server responses and unexpected internal error responses become findings', () => {
  const lspStep = { request: { id: 7, method: 'initialize' } };
  assert.throws(() => checkLspResponse(lspStep, { jsonrpc: '2.0', id: 8, result: {} }), /ID does not match/);
  assert.throws(() => checkLspResponse(lspStep, { jsonrpc: '2.0', id: 7,
    error: { code: -32602, message: 'Unexpected internal exception' } }), /Unexpected LSP error/);
  const malformedLsp = { request: null, requireError: true, acceptError: error => error.code === -32600 };
  checkLspResponse(malformedLsp, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
  assert.throws(() => checkLspResponse(malformedLsp, { jsonrpc: '2.0', id: null, result: {} }), /accepted a malformed request/);
  const dapStep = { request: { seq: 7, command: 'initialize' } };
  assert.throws(() => checkDapResponse(dapStep, { seq: 1, type: 'response', request_seq: 7,
    command: 'initialize', success: false, message: 'Unexpected internal exception' }), /Unexpected DAP error/);
});

test('protocol sequences: output callback failures are rethrown after the server error boundary', () => {
  const output = new ProtocolSequenceOutput('lsp', context);
  const event = { jsonrpc: '2.0', method: 'textDocument/publishDiagnostics' };
  event.params = { cycle: event };
  output.record(event, true);
  assert.throws(() => output.checkpoint(), TypeError);
  const dapOutput = new ProtocolSequenceOutput('dap', context);
  dapOutput.record({ seq: 1, type: 'event', event: 'initialized' }, true);
  dapOutput.record({ seq: 1, type: 'event', event: 'initialized' }, true);
  assert.throws(() => dapOutput.checkpoint(), /sequence did not increase/);
});

test('protocol sequences: event count is capped even when every individual event is small', () => {
  const output = new ProtocolSequenceOutput('lsp', context);
  for (let index = 0; index < 129; index++) output.record({ jsonrpc: '2.0', method: 'event' }, true);
  assert.throws(() => output.checkpoint(), error => error.code === 'PROTOCOL_SEQUENCE_EVENT_LIMIT');
});
