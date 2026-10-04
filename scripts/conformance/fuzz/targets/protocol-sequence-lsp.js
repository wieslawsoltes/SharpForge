import { LanguageServer } from '@sharpforge/protocol';
import { Workspace } from '@sharpforge/workspace';
import { requireProtocol } from './protocol-sequence-messages.js';

const uri = 'fuzz:///Program.cs';
const secondUri = 'fuzz:///Second.cs';
const sources = ['int count = 1;\nConsole.WriteLine(count);\n', 'int count = 2;\nConsole.WriteLine(count);\n', 'int count = "bad";\n'];
const missingDocumentErrors = new Set(['Document is not open', 'Cannot format a generated or missing document']);

/** Stable operation numbers form the local fuzz input format, not an arbitrary LSP method dispatcher. */
export const lspSequenceOperations = Object.freeze({
  initialize: 0, initialized: 1, open: 2, change: 3, close: 4, openSecond: 5,
  hover: 6, completion: 7, symbols: 8, semanticTokens: 9, folding: 10, selection: 11,
  formatting: 12, workspaceSymbols: 13, unknown: 14, nullParameters: 15, missingDocument: 16,
  shutdown: 17, cancel: 18, nullEnvelope: 19, arrayEnvelope: 20, missingMethod: 21,
});

function request(id, method, params = {}) {
  return { request: { jsonrpc: '2.0', id, method, params } };
}

function notification(method, params = {}, checkState) {
  return { request: { jsonrpc: '2.0', method, params }, notification: true, checkState };
}

function invalidParameters(id, method, params, message) {
  return { ...request(id, method, params), requireError: true,
    acceptError: error => error.code === -32602 && error.message === message };
}

function invalidEnvelope(value) {
  return { request: value, invalidEnvelope: true, requireError: true,
    acceptError: error => error.code === -32600 && error.message === 'Invalid Request' };
}

function open(state, variant, targetUri = uri) {
  const text = targetUri === uri ? sources[variant % sources.length] : 'class Second { public int Value; }';
  const version = (state.workspace.documents.get(targetUri)?.source.version ?? 0) + 1;
  return notification('textDocument/didOpen', { textDocument: { uri: targetUri, languageId: 'csharp', version, text } }, () => {
    const source = state.workspace.documents.get(targetUri)?.source;
    requireProtocol(source?.text === text && source.version === version, 'LSP didOpen lost a bounded document');
  });
}

function change(state, variant) {
  const previous = state.workspace.documents.get(uri)?.source;
  const text = sources[(variant + 1) % sources.length], version = (previous?.version ?? 0) + 1;
  return notification('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] }, () => {
    const source = state.workspace.documents.get(uri)?.source;
    if (previous) requireProtocol(source?.text === text && source.version === version, 'LSP didChange lost an accepted edit');
    else requireProtocol(source === undefined, 'LSP changed a document that was never opened');
  });
}

function query(state, id, method, extra = {}, checkResult) {
  const step = request(id, method, { textDocument: { uri }, ...extra });
  if (!state.workspace.documents.has(uri)) {
    step.acceptError = error => error.code === -32602 && missingDocumentErrors.has(error.message);
  }
  step.checkResult = checkResult;
  return step;
}

function formatting(state, id, variant) {
  if (variant === 0) return query(state, id, 'textDocument/formatting', { options: { tabSize: 2, insertSpaces: true } }, arrayResult);
  return { ...request(id, 'textDocument/formatting', { textDocument: { uri }, options: { tabSize: 0, insertSpaces: true } }),
    requireError: true, acceptError: error => error.code === -32602 && error.message === 'tabSize must be between 1 and 16' };
}

const position = variant => ({ line: 0, character: [0, 4, 9, 16][variant % 4] });
const arrayResult = value => requireProtocol(Array.isArray(value), 'LSP query did not return an array');
const operations = [
  (state, id) => request(id, 'initialize', { capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } }),
  () => notification('initialized'),
  (state, id, variant) => open(state, variant),
  (state, id, variant) => change(state, variant),
  state => notification('textDocument/didClose', { textDocument: { uri } }, () => {
    requireProtocol(!state.workspace.documents.has(uri), 'LSP didClose retained its document');
  }),
  (state, id, variant) => open(state, variant, secondUri),
  (state, id, variant) => query(state, id, 'textDocument/hover', { position: position(variant) }),
  (state, id, variant) => query(state, id, 'textDocument/completion', { position: position(variant) }, value => {
    requireProtocol(Array.isArray(value?.items) && typeof value.isIncomplete === 'boolean', 'LSP completion schema is invalid');
  }),
  (state, id) => query(state, id, 'textDocument/documentSymbol', {}, arrayResult),
  (state, id) => query(state, id, 'textDocument/semanticTokens/full', {}, value => {
    requireProtocol(Array.isArray(value?.data) && value.data.length % 5 === 0, 'LSP semantic tokens are malformed');
  }),
  (state, id) => query(state, id, 'textDocument/foldingRange', {}, arrayResult),
  (state, id, variant) => query(state, id, 'textDocument/selectionRange', { positions: [position(variant)] }, arrayResult),
  (state, id, variant) => formatting(state, id, variant),
  (state, id) => ({ ...request(id, 'workspace/symbol', { query: 'count' }), checkResult: arrayResult }),
  (state, id) => ({ ...request(id, 'sharpforge/fuzz-unknown'), requireError: true,
    acceptError: error => error.code === -32601 && error.message === "Method 'sharpforge/fuzz-unknown' is not implemented" }),
  (state, id) => invalidParameters(id, 'textDocument/hover', null, 'params must be an object'),
  (state, id) => invalidParameters(id, 'textDocument/hover', { position: { line: 0, character: 0 } },
    'params.textDocument must be an object'),
  (state, id) => request(id, 'shutdown'),
  (state, id) => notification('$/cancelRequest', { id: Math.max(1, id - 1) }),
  () => invalidEnvelope(null),
  () => invalidEnvelope([]),
  (state, id) => invalidEnvelope({ jsonrpc: '2.0', id }),
];

/** Actual LSP handlers operate on at most two fixed URI documents with no extensions or external files. */
export function createLspSequence(output, limits) {
  const workspace = new Workspace({ maxDocumentLength: 2048, maxDocuments: 2, tokenCacheSize: 1024 });
  const server = new LanguageServer({ workspace, send: event => output.record(event, true) });
  const state = { workspace, server };
  return {
    server,
    step(byte, id) {
      const step = operations[byte % operations.length](state, id, Math.floor(byte / operations.length));
      step.ignored = server.shutdown;
      if (server.shutdown && !step.notification && !step.invalidEnvelope) {
        step.requireError = true;
        step.acceptError = error => error.code === -32600 && error.message === 'The language server has shut down';
      }
      return step;
    },
    after(step) {
      limits.signal?.throwIfAborted();
      if (!step.ignored) step.checkState?.();
      requireProtocol(workspace.documents.size <= 2 && workspace.generatedDocuments.size === 0, 'LSP document count grew');
      let bytes = 0;
      for (const document of workspace.documents.values()) {
        bytes += Buffer.byteLength(document.source.text, 'utf8');
        requireProtocol(document.source.length <= 2048, 'LSP document length grew');
      }
      requireProtocol(bytes <= 4096, 'LSP retained source bytes grew');
    },
    dispose() {
      for (const name of [...workspace.documents.keys()]) workspace.remove(name);
      workspace.generatedDocuments.clear();
    },
  };
}
