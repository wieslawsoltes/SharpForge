import {SourceText} from '@sharpforge/text';

function documentFor(workspace, uri) { return workspace.getDocument?.(uri) ?? workspace.documents?.get(uri); }

/** Capture lazy immutable sources once; no complete source string is needed for selection or chunked search. */
export function captureSearchSnapshots(workspace, options) {
  const documents = options.scope === 'open' ? workspace.listDocuments?.() ?? [...(workspace.documents?.values() ?? [])] :
    [documentFor(workspace, options.uri)];
  return documents.map(document => {
    if (!document) throw new Error('Search document is unavailable');
    const identity = document.source ?? document.model?.snapshot?.();
    const source = identity ?? document;
    const uri = document.uri ?? source.uri;
    const version = document.version ?? source.version;
    if (!Number.isInteger(version)) throw new Error('Search requires versioned documents');
    let positioned;
    return {uri, version, identity, length: source.length ?? source.text.length,
      get text() { return source.text; },
      getText: (start, end) => source.getText?.(start, end) ?? source.text.slice(start, end),
      positionAt(offset) {
        if (source.positionAt) return source.positionAt(offset);
        positioned ??= new SourceText(source.text, uri, version);
        return positioned.positionAt(offset);
      }};
  });
}

export function selectionSearchSnapshots(snapshots, options) {
  if (options.scope !== 'selection') return snapshots;
  const source = snapshots.find(snapshot => snapshot.uri === options.uri);
  const {start, end} = options.selection ?? {};
  if (!source || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) {
    throw new RangeError('Invalid selection search range');
  }
  return [{uri: source.uri, version: source.version, length: end - start, baseOffset: start, basePosition: source.positionAt(start),
    get text() { return source.getText(start, end); }, getText: (from, to) => source.getText(start + from, start + to)}];
}

const word = /[\p{L}\p{N}\p{M}_]/u;

function wholeWord(source, start, end) {
  const before = [...source.getText(Math.max(0, start - 2), start)].at(-1) ?? '';
  const after = [...source.getText(end, Math.min(source.length, end + 2))][0] ?? '';
  return !word.test(before) && !word.test(after);
}

export function restoreSearchCoordinates(result, inputs, snapshots, options) {
  if (options.scope !== 'selection') return result;
  const input = inputs[0];
  const original = snapshots.find(source => source.uri === input.uri);
  const delta = input.baseOffset;
  const matches = result.matches.map(match => ({...match, start: match.start + delta, end: match.end + delta,
    line: match.line + input.basePosition.line,
    character: match.character + (match.line === 0 ? input.basePosition.character : 0),
    indices: match.indices?.map(range => range ? {start: range.start + delta, end: range.end + delta} : null)
  })).filter(match => !options.wholeWord || wholeWord(original, match.start, match.end));
  return {...result, matches};
}

export function validateSearchSnapshots(workspace, snapshots) {
  for (const snapshot of snapshots) {
    const current = documentFor(workspace, snapshot.uri);
    const identity = current?.source ?? current?.model?.snapshot?.();
    if (!current || (current.version ?? identity?.version) !== snapshot.version || snapshot.identity && identity !== snapshot.identity) {
      throw new Error('Search source changed');
    }
  }
}
