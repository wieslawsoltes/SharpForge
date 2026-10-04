import {frameworkType} from '@sharpforge/framework';

function completionMetadata(service, uri, token, completion, intrinsicDocs) {
  const source = service.workspace.documents.get(uri)?.source;
  const before = source?.text.slice(0, token.start) ?? '';
  const match = before.match(/([\p{L}_][\p{L}\p{N}_.]*)\s*\.\s*$/u);
  if (!match) return undefined;
  const receiver = match[1];
  const bound = service.symbolAt(uri, before.lastIndexOf(receiver));
  const type = bound?.type ?? receiver;
  const owner = frameworkType(type)?.name ?? type;
  if (!frameworkType(type) && !intrinsicDocs[type.replace(/^System\./, '')]) return undefined;
  return {owner, name: token.value ?? token.text, kind: completion.kind};
}

/** Public hover data retains structured metadata targets instead of making consumers parse display text. */
export function sourceHover(service, uri, offset, symbolDetail, intrinsicDocs) {
  const symbol = service.symbolAt(uri, offset);
  if (symbol && !symbol.name.startsWith('<')) {
    const reference = service.reference(uri, offset);
    return {contents: symbolDetail(symbol), start: reference.start, end: reference.end, symbol};
  }
  const metadata = service.workspace.sourceModel()?.metadataAt(uri, offset);
  if (metadata) return metadata;
  const token = service.workspace.syntax(uri).tokens.find(item => offset >= item.start && offset <= item.end);
  if (token) {
    const type = frameworkType(token.text);
    if (type) return {contents: type.name + ' · managed web framework (' + type.kind + ')', start: token.start, end: token.end,
      metadata: {owner: type.name, name: type.name.split('.').at(-1), kind: type.kind, type: type.name}};
    const completion = service.completions(uri, token.end).find(item => item.label === token.text);
    if (completion && completion.kind !== 'keyword') return {contents: completion.detail, start: token.start, end: token.end,
      metadata: completionMetadata(service, uri, token, completion, intrinsicDocs)};
    if (intrinsicDocs[token.text]) return {contents: intrinsicDocs[token.text], start: token.start, end: token.end};
  }
  const diagnostic = service.workspace.compile().diagnostics.find(item => item.uri === uri &&
    offset >= item.start && offset <= item.start + item.length);
  return diagnostic ? {contents: `${diagnostic.code}: ${diagnostic.message}`, start: diagnostic.start,
    end: diagnostic.start + diagnostic.length} : null;
}
