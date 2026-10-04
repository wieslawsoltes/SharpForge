/** Wire identifiers shared by initialization, semantic tokens and document symbols. */
export const tokenTypes = [
  'namespace', 'class', 'method', 'field', 'variable',
  'keyword', 'string', 'number', 'operator', 'property'
];

export const symbolKinds = {
  property: 7,
  class: 5,
  struct: 23,
  interface: 11,
  enum: 10,
  delegate: 12,
  method: 6,
  field: 8,
  event: 24,
  local: 13
};

/** Direct adapter calls may omit jsonrpc; one request or notification still needs an object envelope. */
export function isRequestObject(message) {
  return message !== null && typeof message === 'object' && !Array.isArray(message);
}

/** Requests and notifications need a non-empty method name; direct calls may still omit jsonrpc. */
export function isRequest(message) {
  return isRequestObject(message) && typeof message.method === 'string' && message.method.length > 0;
}

/** Invalid requests retain a usable correlation ID, or null when the envelope provides none. */
export function invalidRequest(message) {
  const id = isRequestObject(message) ? message.id : null;
  return {
    jsonrpc: '2.0',
    id: typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) ? id : null,
    error: { code: -32600, message: 'Invalid Request' }
  };
}

const documentMethods = new Set([
  'textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose',
  'textDocument/completion', 'textDocument/hover', 'textDocument/definition', 'textDocument/references',
  'textDocument/rename', 'textDocument/prepareRename', 'textDocument/documentHighlight',
  'textDocument/foldingRange', 'textDocument/selectionRange', 'textDocument/formatting',
  'textDocument/codeAction', 'textDocument/inlayHint', 'textDocument/prepareCallHierarchy',
  'textDocument/codeLens', 'textDocument/documentSymbol', 'textDocument/signatureHelp',
  'textDocument/semanticTokens/full'
]);
const otherParameterMethods = new Set([
  'initialize', 'workspace/symbol', 'callHierarchy/incomingCalls', 'callHierarchy/outgoingCalls'
]);

/** Validate consumed containers before dispatch; nested method-specific values keep their existing contracts. */
export function validateParameters(method, parameters) {
  const needsDocument = documentMethods.has(method);
  if (!needsDocument && !otherParameterMethods.has(method)) return;
  if (!isRequestObject(parameters)) throw new Error('params must be an object');
  if (!needsDocument) return;
  if (!isRequestObject(parameters.textDocument)) throw new Error('params.textDocument must be an object');
  const uri = parameters.textDocument.uri;
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('params.textDocument.uri must be a non-empty string');
  }
}

/** Encode source tokens into the existing LSP relative-position wire format, excluding line terminators. */
export function encodeSemanticTokens(source, tokens) {
  const data = [];
  let previousLine = 0;
  let previousStart = 0;
  for (const token of tokens) {
    let at = token.start;
    while (at < token.end) {
      const position = source.positionAt(at);
      const end = Math.min(token.end, source.lineStarts[position.line + 1] ?? source.length);
      let length = end - at;
      while (length > 0 && /[\r\n]/.test(source.text[at + length - 1])) length--;
      if (length > 0) {
        const lineDelta = position.line - previousLine;
        const kind = token.kind === 'local' ? 'variable' : token.kind;
        data.push(lineDelta, lineDelta === 0 ? position.character - previousStart : position.character,
          length, Math.max(0, tokenTypes.indexOf(kind)), 0);
        previousLine = position.line;
        previousStart = position.character;
      }
      at = end;
    }
  }
  return data;
}
