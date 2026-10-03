import {keywords} from '@sharpforge/syntax';

const bracketKinds = new Set(['(', ')', '[', ']', '{', '}']);
const stringKinds = new Set(['string', 'char', 'interpolated']);

/** Read only tokens covering [start,end); adjacent trivia/comment spans are coalesced. */
export function tokenRuns(tokens, {start, end, maxRuns}) {
  const runs = [];
  let cursor = start;
  const push = (from, to, kind = '', bracket = false) => {
    from = Math.max(start, from);
    to = Math.min(end, to);
    if (to <= from) return;
    const previous = runs.at(-1);
    if (previous?.end === from && previous.kind === kind && !bracket && !previous.bracket) previous.end = to;
    else runs.push({start: from, end: to, kind, bracket});
    cursor = Math.max(cursor, to);
  };
  for (let index = Math.max(0, tokens.indexAt(start) - 1); index < tokens.length; index++) {
    const token = tokens.get(index);
    if (token.fullStart >= end) break;
    if (runs.length > maxRuns) return null;
    const trivia = [...(token.leadingTrivia ?? []), ...(token.trailingTrivia ?? [])];
    const spans = [{
      start: token.start, end: token.end,
      kind: classify(token, tokens.get(index - 1), tokens.get(index + 1)), bracket: bracketKinds.has(token.kind)
    }];
    for (const item of trivia) {
      const comment = /comment/i.test(item.kind) || item.text?.startsWith('//') || item.text?.startsWith('/*');
      spans.push({start: item.start, end: item.end, kind: comment ? 'comment' : '', bracket: false});
    }
    spans.sort((left, right) => left.start - right.start);
    for (const span of spans) {
      if (span.end <= cursor) continue;
      push(cursor, span.start);
      push(Math.max(cursor, span.start), span.end, span.kind, span.bracket);
    }
  }
  push(cursor, end);
  return runs.length > maxRuns ? null : runs;
}

function classify(token, previous, next) {
  if (stringKinds.has(token.kind) || /string/.test(token.kind)) return 'string';
  if (['integer', 'double'].includes(token.kind)) return 'number';
  if (keywords.has(token.kind)) return 'keyword';
  if (token.kind !== 'identifier') return 'punctuation';
  if (['class', 'struct', 'interface', 'enum', 'record'].includes(previous?.kind)) return 'type';
  if (token.text[0] === token.text[0]?.toUpperCase() && token.text[0] !== token.text[0]?.toLowerCase()) return 'type';
  return next?.kind === '(' ? 'method' : 'identifier';
}
