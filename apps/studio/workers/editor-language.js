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

function hierarchyItem(workspace, item, {projectId, revision}) {
  const source = sourceFor(workspace, {uri: item.uri});
  return {...item, version: source.version, ...(projectId ? {projectId} : {}),
    ...(revision === undefined ? {} : {projectRevision: revision})};
}

function hierarchyCalls(workspace, language, parameters, direction) {
  sourceFor(workspace, parameters);
  const item = parameters.item;
  if (!item || item.uri !== parameters.uri || item.version !== undefined && item.version !== parameters.version ||
      item.projectId !== undefined && item.projectId !== parameters.projectId ||
      item.projectRevision !== undefined && item.projectRevision !== parameters.revision) {
    failure('SFED1202', 'Call hierarchy belongs to another source or project');
  }
  return language.calls(item, direction).map(call => ({
    item: hierarchyItem(workspace, call.item, parameters),
    ranges: call.ranges.map(range => hierarchyItem(workspace, range, parameters))
  }));
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
      return language.references(parameters.uri, offsetFor(source, parameters.offset), parameters.includeDeclaration !== false)
        .map(reference => parameters.projectId ? {...reference, projectId: parameters.projectId} : reference);
    },
    callHierarchy(parameters) {
      const source = sourceFor(workspace, parameters);
      return language.callHierarchy(parameters.uri, offsetFor(source, parameters.offset))
        .map(item => hierarchyItem(workspace, item, parameters));
    },
    incomingCalls(parameters) { return hierarchyCalls(workspace, language, parameters, 'incoming'); },
    outgoingCalls(parameters) { return hierarchyCalls(workspace, language, parameters, 'outgoing'); },
    rename(parameters) {
      const source = sourceFor(workspace, parameters);
      const action = refactoring.rename(parameters.uri, offsetFor(source, parameters.offset), parameters.newName, parameters);
      if (!action.resources.length) return action.edits;
      const groups = new Map();
      for (const edit of action.edits) {
        if (!groups.has(edit.uri)) groups.set(edit.uri, []);
        groups.get(edit.uri).push(edit);
      }
      return {title: action.title, documentChanges: [...groups].map(([uri, edits]) => ({
        textDocument: {uri, version: edits[0].version}, edits
      })).concat(action.resources)};
    },
    symbols(parameters) {
      sourceFor(workspace, parameters);
      return language.documentSymbols(parameters.uri).map(symbol => parameters.projectId ? {...symbol, projectId: parameters.projectId} : symbol);
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
      if (parameters.scope) return [refactoring.fixAll(parameters)];
      const start = offsetFor(source, parameters.offset);
      const end = offsetFor(source, parameters.end ?? start);
      return refactoring.actions(parameters.uri, start, end);
    },
    resolveCodeAction(parameters) {
      const source = sourceFor(workspace, parameters);
      const action = parameters.action;
      if (!action?.data || action.data.uri !== source.uri || action.data.version !== source.version) {
        failure('SFED1202', 'Code action belongs to an older document');
      }
      const result = refactoring.actions(source.uri, action.data.start, action.data.end)
        .find(item => item.equivalenceKey === action.equivalenceKey);
      if (!result) failure('SFED1204', 'Code action is no longer available');
      return result;
    },
    outlineReorder(parameters) {
      sourceFor(workspace, parameters);
      return refactoring.outlineReorder(parameters);
    },
    validateWorkspaceEdit(parameters) {
      const source = sourceFor(workspace, parameters);
      const rename = parameters.rename ? language.renamePlan(source.uri,
        offsetFor(source, parameters.rename.offset), parameters.rename.newName) : undefined;
      return refactoring.validateEdits(parameters.edits, {rename});
    },
    format(parameters) {
      sourceFor(workspace, parameters);
      return {title: 'Format document indentation', edits: formatDocument(workspace, parameters.uri, parameters.options)};
    },
    signatureHelp(parameters) {
      const source = sourceFor(workspace, parameters);
      const offset = offsetFor(source, parameters.offset);
      if (parameters.callStart !== undefined) {
        const callStart = offsetFor(source, parameters.callStart);
        if (callStart >= offset || source.text[callStart] !== '(') failure('SFED1203', 'Invalid signature invocation start');
      }
      if (parameters.activeParameter !== undefined && (!Number.isInteger(parameters.activeParameter) || parameters.activeParameter < 0)) {
        failure('SFED1203', 'Invalid signature parameter index');
      }
      // The editor's lexical count is a hint; bound syntax knows commas in nested generic type arguments.
      const help = language.signatureHelp(parameters.uri, offset, {callStart: parameters.callStart});
      return help ? {...help, version: source.version} : null;
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
      const reference = language.reference(parameters.uri, offset);
      if (!reference || !workspace.documents.has(parameters.uri)) return null;
      return language.prepareRename(parameters.uri, offset);
    },
    documentHighlights(parameters) {
      const source = sourceFor(workspace, parameters);
      offsetFor(source, parameters.offset);
      return {version: source.version, items: language.references(parameters.uri, parameters.offset)
        .filter(reference => reference.uri === parameters.uri)
        .map(reference => ({...reference, kind: reference.write ? 3 : reference.read ? 2 : 1}))};
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
