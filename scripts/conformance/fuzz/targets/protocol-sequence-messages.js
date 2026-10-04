import { encodeProtocolMessage } from '@sharpforge/protocol';
import { TextTargetRejection } from './text-contract.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A failed server invariant is a finding, never a malformed-input rejection. */
export function requireProtocol(condition, message) {
  if (!condition) throw new Error('Protocol sequence invariant: ' + message);
}

/** Validate correlation and the error contract for one owned LSP request. */
export function checkLspResponse(step, response) {
  if (step.notification) {
    requireProtocol(response === null, 'LSP notification produced a response');
    return;
  }
  requireProtocol(isObject(response) && response.jsonrpc === '2.0', 'LSP response envelope is invalid');
  const expectedId = isObject(step.request) && Object.hasOwn(step.request, 'id') ? step.request.id : null;
  requireProtocol(response.id === expectedId, 'LSP response ID does not match');
  const hasError = Object.hasOwn(response, 'error'), hasResult = Object.hasOwn(response, 'result');
  requireProtocol(hasError !== hasResult, 'LSP response needs exactly one result or error');
  if (hasError) {
    requireProtocol(isObject(response.error) && Number.isInteger(response.error.code)
      && typeof response.error.message === 'string', 'LSP error schema is invalid');
    requireProtocol(step.acceptError?.(response.error) === true, 'Unexpected LSP error response');
  } else {
    requireProtocol(!step.requireError, 'LSP accepted a malformed request');
    step.checkResult?.(response.result);
  }
}

/** Validate one DAP response without interpreting an internal failure as an expected success. */
export function checkDapResponse(step, response) {
  requireProtocol(isObject(response) && response.type === 'response', 'DAP response envelope is invalid');
  requireProtocol(Number.isSafeInteger(response.seq) && response.seq > 0, 'DAP response sequence is invalid');
  requireProtocol(Number.isSafeInteger(response.request_seq) && response.request_seq >= 0, 'DAP correlation is invalid');
  requireProtocol(typeof response.command === 'string' && typeof response.success === 'boolean', 'DAP response schema is invalid');
  if (isObject(step.request) && Number.isSafeInteger(step.request.seq)) {
    requireProtocol(response.request_seq === step.request.seq, 'DAP response request sequence does not match');
  }
  if (typeof step.request?.command === 'string') {
    requireProtocol(response.command === step.request.command, 'DAP response command does not match');
  }
  if (!response.success) {
    requireProtocol(typeof response.message === 'string' && response.message.length > 0, 'DAP error has no diagnostic');
    requireProtocol(step.acceptError?.(response) === true, 'Unexpected DAP error response');
  } else {
    requireProtocol(!step.requireError, 'DAP accepted a malformed request');
    requireProtocol(isObject(response.body), 'DAP success body is invalid');
    step.checkResult?.(response.body);
  }
}

/** Count encoded output without retaining responses; defer callback failures past the server's catch boundary. */
export class ProtocolSequenceOutput {
  constructor(protocol, limits) {
    this.protocol = protocol;
    this.limits = limits;
    this.bytes = 0;
    this.events = 0;
    this.lastSequence = 0;
    this.failure = null;
  }

  record(message, event = false) {
    if (this.failure || message === null) return;
    try {
      if (event) {
        if (++this.events > 128) throw new TextTargetRejection('PROTOCOL_SEQUENCE_EVENT_LIMIT');
        if (this.protocol === 'lsp') {
          requireProtocol(isObject(message) && message.jsonrpc === '2.0'
            && typeof message.method === 'string' && !Object.hasOwn(message, 'id'), 'Invalid LSP event');
        } else {
          requireProtocol(isObject(message) && message.type === 'event' && typeof message.event === 'string', 'Invalid DAP event');
        }
      }
      if (this.protocol === 'dap') {
        requireProtocol(Number.isSafeInteger(message.seq) && message.seq > this.lastSequence, 'DAP output sequence did not increase');
        this.lastSequence = message.seq;
      }
      this.bytes += encodeProtocolMessage(message, { maxMessageBytes: this.limits.maxOutputBytes }).length;
      if (this.bytes > this.limits.maxOutputBytes) throw new TextTargetRejection('FUZZ_OUTPUT_LIMIT');
    } catch (error) {
      this.failure = error instanceof RangeError && error.message === 'Protocol message exceeds limit'
        ? new TextTargetRejection('FUZZ_OUTPUT_LIMIT') : error;
    }
  }

  checkpoint() {
    this.limits.signal?.throwIfAborted();
    if (this.failure) throw this.failure;
  }
}
