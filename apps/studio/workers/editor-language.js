import {foldingRanges, formatDocument, selectionRanges} from '@sharpforge/refactoring';

function failure(code, message) {
  const error = new Error(message);
  error.name = 'EditorServiceError';
  error.code = code;
  throw error;
}

function sourceFor(workspace, parameters) {
  const source = (workspace.documents.get(parameters.uri) ?? workspace.generatedDocuments.get(parameters.uri))?.source;
  if (!source) failure('SFED1201', `Language document is unavailable: ${parameters.uri}`);
  if (parameters.version !== undefined && source.version !== parameters.version) {
    failure('SFED1202', `Language document version changed: ${parameters.uri}`);
  }
  return source;
}

function offsetFor(source, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) failure('SFED1203', 'Invalid language request offset');
  return offset;
}

function rangeFor(source, parameters) {
  const start = offsetFor(source, parameters.start ?? (parameters.range ? source.offsetAt(parameters.range.start) : 0));
  const end = offsetFor(source, parameters.end ?? (parameters.range ? source.offsetAt(parameters.range.end) : source.length));
  if (end < start) failure('SFED1203', 'Invalid language request range');
  return {start, end};
}

function rangeFormatting(workspace, parameters) {
  const source = sourceFor(workspace, parameters);
  const range = rangeFor(source, parameters);
  const firstLine = source.positionAt(range.start).line;
  const lastLine = source.positionAt(Math.max(range.start, range.end - 1)).line;
  const start = source.lineStarts[firstLine];
  const end = source.lineStarts[lastLine + 1] ?? source.length + 1;
  return formatDocument(workspace, parameters.uri, parameters.options).filter(edit => edit.start >= start && edit.start < end);
}

/** Register pure editor requests against the worker's existing workspace and language-service instances. */
export function registerEditorLanguageHandlers(handlers, {workspace, language, refactoring}) {
  const methods = {
    completion(parameters) {
      const source = sourceFor(workspace, parameters);
      return language.completions(parameters.uri, offsetFor(source, parameters.offset));
    },
    hover(parameters) {
      const source = sourceFor(workspace, parameters);
      return language.hover(parameters.uri, offsetFor(source, parameters.offset));
    },
    definition(parameters) {
      const source = sourceFor(workspace, parameters);
      return language.definition(parameters.uri, offsetFor(source, parameters.offset));
    },
    references(parameters) {
      const source = sourceFor(workspace, parameters);
      return language.references(parameters.uri, offsetFor(source, parameters.offset), parameters.includeDeclaration !== false);
    },
    rename(parameters) {
      const source = sourceFor(workspace, parameters);
      if (parameters.includeComments || parameters.includeStrings || parameters.renameFile) {
        failure('SFED1205', 'This bound rename provider does not rename comments, strings, or files');
      }
      return refactoring.rename(parameters.uri, offsetFor(source, parameters.offset), parameters.newName).edits;
    },
    symbols(parameters) {
      sourceFor(workspace, parameters);
      return language.documentSymbols(parameters.uri);
    },
    referenceLenses(parameters) {
      sourceFor(workspace, parameters);
      return language.referenceLenses(parameters.uri);
    },
    selectionRanges(parameters) {
      const source = sourceFor(workspace, parameters);
      if (!Array.isArray(parameters.offsets) || parameters.offsets.length > 1000) failure('SFED1203', 'Invalid selection offsets');
      return selectionRanges(workspace, parameters.uri, parameters.offsets.map(offset => offsetFor(source, offset)));
    },
    codeActions(parameters) {
      const source = sourceFor(workspace, parameters);
      if (parameters.scope) failure('SFED1205', 'Fix All is not supported by this refactoring provider');
      const start = offsetFor(source, parameters.offset);
      const end = offsetFor(source, parameters.end ?? start);
      return refactoring.actions(parameters.uri, start, end);
    },
    format(parameters) {
      sourceFor(workspace, parameters);
      return {title: 'Format document indentation', edits: formatDocument(workspace, parameters.uri, parameters.options)};
    },
    signatureHelp(parameters) {
      const source = sourceFor(workspace, parameters);
      let offset = offsetFor(source, parameters.offset);
      if (parameters.callStart !== undefined) {
        const callStart = offsetFor(source, parameters.callStart);
        if (callStart >= offset || source.text[callStart] !== '(') failure('SFED1203', 'Invalid signature invocation start');
        offset = callStart + 1;
      }
      const help = language.signatureHelp(parameters.uri, offset);
      if (!help) return null;
      const activeParameter = parameters.activeParameter ?? help.activeParameter;
      if (!Number.isInteger(activeParameter) || activeParameter < 0) failure('SFED1203', 'Invalid signature parameter index');
      return {...help, activeParameter, version: source.version};
    },
    diagnostics(parameters) {
      const source = sourceFor(workspace, parameters);
      return {version: source.version, items: language.diagnostics(parameters.uri)};
    },
    semanticTokens(parameters) {
      const source = sourceFor(workspace, parameters);
      return {version: source.version, items: language.semanticTokens(parameters.uri)};
    },
    foldingRanges(parameters) {
      sourceFor(workspace, parameters);
      return foldingRanges(workspace, parameters.uri);
    },
    inlayHints(parameters) {
      const source = sourceFor(workspace, parameters);
      return {version: source.version, items: language.inlayHints(parameters.uri, rangeFor(source, parameters))};
    },
    prepareRename(parameters) {
      const source = sourceFor(workspace, parameters);
      const offset = offsetFor(source, parameters.offset);
      const symbol = language.symbolAt(parameters.uri, offset);
      const reference = language.reference(parameters.uri, offset);
      if (!symbol || !reference || !workspace.documents.has(parameters.uri)) return null;
      if (symbol.kind === 'class') failure('SFED1204', 'Type rename is not supported until all type syntax is bound');
      return {start: reference.start, end: reference.end, placeholder: symbol.name, version: source.version};
    },
    documentHighlights(parameters) {
      const source = sourceFor(workspace, parameters);
      offsetFor(source, parameters.offset);
      return {version: source.version, items: language.references(parameters.uri, parameters.offset)
        .filter(reference => reference.uri === parameters.uri).map(reference => ({...reference, kind: 1}))};
    },
    formatRange(parameters) { return rangeFormatting(workspace, parameters); },
    formatOnType(parameters) {
      if (![';', '}'].includes(parameters.character)) return [];
      return rangeFormatting(workspace, parameters);
    },
    readDocument(parameters) {
      const uri = parameters.targetUri ?? parameters.uri;
      const document = workspace.documents.get(uri) ?? workspace.generatedDocuments.get(uri);
      if (!document) failure('SFED1201', `Language document is unavailable: ${uri}`);
      return {uri, text: document.source.text, version: document.source.version, readOnly: !workspace.documents.has(uri)};
    }
  };
  const unregister = Object.entries(methods).map(([method, callback]) => handlers.registerHandler(method, callback));
  return () => { for (const dispose of unregister) dispose(); };
}
