import { DebugAdapter } from '@sharpforge/protocol';
import { assembleILDocument } from '@sharpforge/cil';
import { createILDocumentSeed } from './text-il-seeds.js';
import { requireProtocol } from './protocol-sequence-messages.js';

const pausedError = 'A paused or suspended debug session is required';
const configuredError = 'A configured, paused debug session is required';
const instructionReference = 'il:06000001:00000000';

/** Stable bytes select only these fixed requests; launch input and expressions are never taken from fuzz bytes. */
export const dapSequenceOperations = Object.freeze({
  initialize: 0, launch: 1, configure: 2, threads: 3, stack: 4, scopes: 5, variables: 6,
  continue: 7, next: 8, breakpoints: 9, instructionBreakpoints: 10, loadedSources: 11,
  disassemble: 12, exceptions: 13, disconnect: 14, badBreakpoints: 15, expiredVariables: 16,
  unknown: 17, restart: 18, nullEnvelope: 19, arrayEnvelope: 20, missingCommand: 21,
  evaluate: 22, nullArguments: 23, terminate: 24,
});

function request(seq, command, args = {}) {
  return { request: { seq, type: 'request', command, arguments: args } };
}

function withErrors(step, messages, requireError = false) {
  step.acceptError = response => messages.includes(response.message);
  step.requireError = requireError;
  return step;
}

function malformed(value) {
  // The current API has no explicit envelope/argument diagnostic: caught native exceptions remain findings.
  return { request: value, requireError: true };
}

function query(state, seq, command, args, messages = [pausedError], checkResult) {
  const step = withErrors(request(seq, command, args), messages);
  step.checkResult = checkResult;
  return step;
}

function ownedLaunch(state, seq) {
  state.assembly ??= assembleILDocument(createILDocumentSeed()).bytes;
  requireProtocol(state.assembly.byteLength <= 4096, 'Owned DAP launch fixture exceeded its byte budget');
  return request(seq, 'launch', {
    assembly: state.assembly,
    managedIL: true,
    methodToken: 0x06000001,
    stopOnEntry: true,
    virtualTime: true,
    recordHistory: false,
    maxHistory: 0,
    maxHistoryBytes: 0,
    maxInstructions: 64,
  });
}

const operations = [
  (state, seq, variant) => request(seq, 'initialize', { adapterID: 'fuzz', linesStartAt1: variant % 2 === 0 }),
  (state, seq) => ownedLaunch(state, seq),
  (state, seq) => withErrors(request(seq, 'configurationDone'), ['Launch a debug session first', 'Debug session is already configured']),
  (state, seq) => query(state, seq, 'threads', {}, [], body => {
    requireProtocol(Array.isArray(body.threads), 'DAP threads schema is invalid');
  }),
  (state, seq) => query(state, seq, 'stackTrace', { threadId: 1, startFrame: 0, levels: 4 }, [pausedError], body => {
    requireProtocol(Array.isArray(body.stackFrames) && Number.isInteger(body.totalFrames), 'DAP stack schema is invalid');
  }),
  (state, seq) => query(state, seq, 'scopes', { frameId: state.server.session?.vm.top?.id ?? 1 }),
  (state, seq) => query(state, seq, 'variables', { variablesReference: state.server.refs.keys().next().value ?? -1, count: 4 },
    [pausedError, 'Variable reference has expired', 'Stack frame no longer exists']),
  (state, seq) => withErrors(request(seq, 'continue', { threadId: 1 }), [configuredError]),
  (state, seq) => withErrors(request(seq, 'next', { threadId: 1, granularity: 'instruction' }), [configuredError]),
  (state, seq) => request(seq, 'setBreakpoints', { source: { path: 'fuzz:///Program.cs' }, breakpoints: [{ line: 1 }] }),
  (state, seq) => request(seq, 'setInstructionBreakpoints', { breakpoints: [{ instructionReference }] }),
  (state, seq) => query(state, seq, 'loadedSources', {}, [], body => {
    requireProtocol(Array.isArray(body.sources), 'DAP source list schema is invalid');
  }),
  (state, seq) => query(state, seq, 'disassemble', { memoryReference: instructionReference, instructionCount: 4 },
    ['Instruction disassembly requires a managedIL launch'], body => {
      requireProtocol(Array.isArray(body.instructions) && body.instructions.length <= 4, 'DAP disassembly was not bounded');
    }),
  (state, seq) => request(seq, 'setExceptionBreakpoints', { filters: ['uncaught'] }),
  (state, seq) => request(seq, 'disconnect'),
  (state, seq) => withErrors(request(seq, 'setBreakpoints', { source: {} }), ['Breakpoint source path is required'], true),
  (state, seq) => withErrors(request(seq, 'variables', { variablesReference: -1 }), [pausedError, 'Variable reference has expired'], true),
  (state, seq) => withErrors(request(seq, 'sharpforge/fuzz-unknown'), ["DAP request 'sharpforge/fuzz-unknown' is not implemented"], true),
  (state, seq) => withErrors(request(seq, 'restart', { arguments: {} }), ['No previous launch']),
  () => malformed(null),
  () => malformed([]),
  (state, seq) => malformed({ seq, type: 'request' }),
  (state, seq) => query(state, seq, 'evaluate', { expression: '1 + 2', context: 'watch', frameId: state.server.session?.vm.top?.id }),
  (state, seq) => malformed({ seq, type: 'request', command: 'initialize', arguments: null }),
  (state, seq) => request(seq, 'terminate'),
];

/** Actual DAP server plus one immutable, locally assembled, constant-returning CIL fixture. */
export function createDapSequence(output, limits) {
  const server = new DebugAdapter({ send: event => output.record(event, true) });
  const state = { server, assembly: null };
  return {
    server,
    step(byte, seq) {
      return operations[byte % operations.length](state, seq, Math.floor(byte / operations.length));
    },
    after() {
      limits.signal?.throwIfAborted();
      if (server.configured && server.session?.vm.state === 'running') {
        server.pump({ instructionBudget: 16, timeBudgetMs: 20 });
      }
      output.checkpoint();
      requireProtocol(server.refs.size <= 64 && server.breakpoints.size <= 1 && server.gotoRefs.size === 0, 'DAP maps grew beyond the request cap');
      requireProtocol(server.instructionBreakpoints.length <= 1 && server.functionBreakpoints.length === 0, 'DAP breakpoint input grew');
      if (server.session) {
        requireProtocol(server.session.vm.state !== 'faulted', 'Owned DAP fixture faulted');
        requireProtocol(server.session.vm.instructions <= 64, 'Owned DAP fixture exceeded its instruction cap');
        requireProtocol(server.session.history.length === 0 && server.session.historyBytes === 0, 'Disabled DAP history retained snapshots');
      }
    },
    dispose() {
      server.session?.stop();
      server.refs.clear();
      server.breakpoints.clear();
      server.gotoRefs.clear();
      state.assembly = null;
    },
  };
}
