/** Provider methods take {uri,version,offset?,end?,signal,...} and return data, never mutate the editor. */
export const EDITOR_SERVICE_METHODS = Object.freeze([
  'completion', 'resolveCompletion', 'hover', 'signatureHelp', 'diagnostics', 'codeActions', 'resolveCodeAction',
  'rename', 'prepareRename', 'folding', 'semanticTokens', 'inlayHints', 'codeLens', 'resolveCodeLens',
  'selectionRanges', 'documentHighlights', 'documentSymbols', 'definition', 'references', 'format', 'formatRange', 'formatOnType',
  'executeCommand', 'readDocument', 'projects', 'documentationComment'
]);

export class EditorServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EditorServiceError';
    this.code = code;
  }
}

/** An explicit instance-scoped provider registry suitable for an editor without Studio. */
export class EditorLanguageServices {
  constructor(providers = {}) {
    this.providers = new Map();
    this.disposables = new Set();
    this.disposed = false;
    for (const [method, provider] of Object.entries(providers)) this.register(method, provider);
  }

  register(method, provider) {
    if (!EDITOR_SERVICE_METHODS.includes(method)) throw new EditorServiceError('SFED1001', `Unknown editor provider: ${method}`);
    if (typeof provider !== 'function') throw new TypeError('Editor provider must be a function');
    if (this.disposed) throw new EditorServiceError('SFED1002', 'Editor services are disposed');
    if (this.providers.has(method)) throw new EditorServiceError('SFED1003', `Provider already registered: ${method}`);
    this.providers.set(method, provider);
    return () => { if (this.providers.get(method) === provider) this.providers.delete(method); };
  }

  supports(method) {
    return !this.disposed && this.providers.has(method);
  }

  async invoke(method, parameters) {
    if (parameters.signal?.aborted) throw new DOMException('Editor request cancelled', 'AbortError');
    if (!this.supports(method)) throw new EditorServiceError('SFED1004', `No ${method} provider is registered`);
    return this.providers.get(method)(parameters);
  }

  dispose() {
    this.disposed = true;
    this.providers.clear();
    for (const dispose of this.disposables) dispose();
    this.disposables.clear();
  }
}

/** Adapts a data-only RPC callback. Supported methods must be explicitly advertised. */
export function createRequestServices(request, methods = ['completion', 'hover'], options = {}) {
  const services = new EditorLanguageServices();
  for (const entry of methods) {
    const method = typeof entry === 'string' ? entry : entry.method;
    const remote = typeof entry === 'string' ? options.aliases?.[method] ?? method : entry.remote ?? method;
    services.register(method, parameters => request(remote, parameters));
  }
  return services;
}

export function serviceItems(result) {
  if (Array.isArray(result)) return result;
  return result?.items ?? result?.data ?? [];
}
