import { runTextTarget, TextTargetRejection } from './text-contract.js';
import { createLspSequence, lspSequenceOperations } from './protocol-sequence-lsp.js';
import { createDapSequence, dapSequenceOperations } from './protocol-sequence-dap.js';
import { ProtocolSequenceOutput, checkDapResponse, checkLspResponse } from './protocol-sequence-messages.js';

const encoder = new TextEncoder();
const marker = encoder.encode('sequence:');
const headers = { lsp: encoder.encode('sequence:lsp\n'), dap: encoder.encode('sequence:dap\n') };
const prefixMatches = (input, prefix) => input.length >= prefix.length && prefix.every((byte, index) => input[index] === byte);

/** Each payload byte selects an owned command and argument variant; it cannot name a module, file or program. */
export function protocolSequenceSeed(name, protocol, operations) {
  const header = headers[protocol];
  if (!header || !operations.length || operations.length > 32) throw new RangeError('Invalid protocol seed description');
  if (operations.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new RangeError('Invalid operation byte');
  const input = new Uint8Array(header.length + operations.length);
  input.set(header);
  input.set(operations, header.length);
  return { name, input };
}

/** Distinguish the explicit semantic mode from ordinary Content-Length framing. */
export function isProtocolSequence(input) {
  return input instanceof Uint8Array && prefixMatches(input, marker);
}

export function createProtocolSequenceSeeds() {
  const lsp = lspSequenceOperations, dap = dapSequenceOperations;
  return [
    protocolSequenceSeed('lsp-document-sequence', 'lsp', [lsp.initialize, lsp.open, lsp.hover, lsp.change,
      lsp.symbols, lsp.semanticTokens, lsp.close, lsp.shutdown]),
    protocolSequenceSeed('lsp-validation-errors', 'lsp', [lsp.initialize, lsp.open,
      lsp.formatting + Object.keys(lsp).length, lsp.close, lsp.hover, lsp.unknown]),
    protocolSequenceSeed('dap-owned-session', 'dap', [dap.initialize, dap.launch, dap.configure, dap.stack,
      dap.scopes, dap.variables, dap.next, dap.continue, dap.disconnect]),
    protocolSequenceSeed('dap-state-errors', 'dap', [dap.stack, dap.configure, dap.badBreakpoints, dap.unknown]),
  ];
}

function prepare(input, limits) {
  const protocol = Object.keys(headers).find(value => prefixMatches(input, headers[value]));
  if (!protocol) return { status: 'unsupported', code: 'PROTOCOL_SEQUENCE_PROFILE_UNSUPPORTED' };
  const operations = input.subarray(headers[protocol].length);
  if (!operations.length || operations.length > 32) throw new TextTargetRejection('PROTOCOL_SEQUENCE_COUNT');
  return { protocol, operations, limits };
}

async function execute({ protocol, operations, limits }) {
  const output = new ProtocolSequenceOutput(protocol, limits);
  const driver = protocol === 'lsp' ? createLspSequence(output, limits) : createDapSequence(output, limits);
  const checkResponse = protocol === 'lsp' ? checkLspResponse : checkDapResponse;
  try {
    for (let index = 0; index < operations.length; index++) {
      output.checkpoint();
      const step = driver.step(operations[index], index + 1);
      const response = await driver.server.handle(step.request);
      output.checkpoint();
      checkResponse(step, response);
      output.record(response);
      output.checkpoint();
      driver.after(step, response);
      output.checkpoint();
    }
    return { status: 'accepted', code: protocol === 'lsp' ? 'PROTOCOL_LSP_SEQUENCE' : 'PROTOCOL_DAP_SEQUENCE' };
  } finally {
    driver.dispose();
  }
}

/** Run actual public server APIs; parent isolation owns wall-clock, heap and process limits. */
export function runProtocolSequence(input, context) {
  const prepared = runTextTarget(input, context, prepare);
  if (prepared.status) return prepared;
  return execute(prepared).catch(error => {
    context?.signal?.throwIfAborted();
    if (error instanceof TextTargetRejection) return { status: 'rejected', code: error.code };
    throw error;
  });
}
