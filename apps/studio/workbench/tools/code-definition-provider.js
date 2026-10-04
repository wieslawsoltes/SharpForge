import {cancellable} from '../events.js';
import {documentSize, readDocumentRange} from '../document-size.js';

/** Extract only a bounded qualified identifier around the caret; structured bound metadata takes precedence. */
export function metadataQuery(documents, file, current, hover) {
  const offset = current.offset ?? 0;
  const around = readDocumentRange(documents, file, {start: Math.max(0, offset - 512),
    end: Math.min(documentSize(documents, file), offset + 512), limit: 1024});
  const identifier = /(?:global::)?@?[\p{ID_Start}_][\p{ID_Continue}]*(?:\s*\.\s*@?[\p{ID_Start}_][\p{ID_Continue}]*)*/gu;
  const at = offset - around.start;
  let expression = '';
  for (const match of around.text.matchAll(identifier)) {
    if (match.index <= at && at <= match.index + match[0].length) { expression = match[0].replace(/\s+/gu, ''); break; }
  }
  const symbol = hover?.symbol;
  const member = symbol && ['method', 'constructor', 'property', 'field', 'event'].includes(symbol.kind);
  const bound = hover?.metadata ?? (member ? {owner: symbol.owner, name: symbol.name, type: symbol.type} :
    symbol ? {type: symbol.type ?? symbol.qualifiedName ?? symbol.name} : {});
  if (bound.kind && !['method', 'constructor', 'property', 'field', 'event'].includes(bound.kind.toLowerCase())) {
    const type = bound.type ?? bound.owner ?? expression;
    return {expression: type, type, assemblyIdentity: bound.assemblyIdentity};
  }
  return {expression, ...bound};
}

/** Follow a source definition first, then resolve real framework/PE declaration metadata without parsing hover prose. */
export async function resolveCodeDefinition({request, documents, readDocument, metadata}, current, {signal} = {}) {
  const file = documents.get(current.uri);
  if (!file) return null;
  const version = file.version;
  const definition = await cancellable(request('definition', {uri: current.uri, offset: current.offset,
    projectId: current.projectId}, {signal}), signal);
  if (definition?.uri) {
    const target = documents.get(definition.uri) ?? await readDocument?.(definition.uri, {signal});
    signal?.throwIfAborted();
    return target ? {target, definition, sourceVersion: version} : null;
  }
  const hover = await cancellable(request('hover', {uri: current.uri, offset: current.offset,
    projectId: current.projectId}, {signal}), signal);
  const target = await metadata.definition(metadataQuery(documents, file, current, hover),
    {projectId: current.projectId, sourceVersion: version, signal});
  signal?.throwIfAborted();
  return target ? {target, definition: target.selection, sourceVersion: version} : null;
}
