import {Scanner} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {responsiveSourceMarker} from './layout-authoring-responsive.js';
import {sourceSyntaxCancellationToken} from './source-cancellation.js';
import {failSource} from './source-errors.js';

/** A marker preserves state identities; the caller still proves every executable statement and reference. */
export function responsiveMethodTrivia(candidate, signal) {
  const {method, parsed} = candidate;
  if (method.body?.kind !== 'Block') return null;
  const start = method.body.start + 1;
  const first = method.body.statements[0]?.start ?? method.body.end - 1;
  const text = parsed.source.text;
  if (!text.slice(start, first).includes(responsiveSourceMarker)) return null;
  const source = text.slice(method.start, method.end);
  const scanner = new Scanner(new SourceText(source, parsed.source.uri), undefined,
    {cancellationToken: sourceSyntaxCancellationToken(signal)});
  const {raws} = scanner.sequence(null);
  if (scanner.diagnostics.some(diagnostic => diagnostic.severity === 'error') || scanner.directives.length) {
    failSource('Adaptive helpers cannot own conditional directives or malformed trivia', method, 'SFSYNC_OWNERSHIP');
  }
  const comments = [];
  for (const token of raws) {
    for (const trivia of [...(token.leading ?? []), ...(token.trailing ?? [])]) {
      if (!trivia.kind.includes('Comment')) continue;
      comments.push({start: method.start + trivia.start, end: method.start + trivia.end,
        text: source.slice(trivia.start, trivia.end), kind: trivia.kind});
    }
  }
  const markers = comments.filter(comment => comment.kind === 'SingleLineCommentTrivia'
    && comment.start > method.body.start && comment.start < first && comment.text.startsWith(responsiveSourceMarker));
  if (markers.length !== 1 || markers[0].text.length > 8192) {
    failSource('Adaptive helpers require one bounded versioned state-identity marker', method, 'SFSYNC_OWNERSHIP');
  }
  let ids;
  try { ids = JSON.parse(markers[0].text.slice(responsiveSourceMarker.length)); }
  catch { failSource('The adaptive state-identity marker is malformed', method, 'SFSYNC_OWNERSHIP'); }
  if (!Array.isArray(ids) || !ids.length || ids.length > 64) {
    failSource('Adaptive source requires between one and 64 state identities', method, 'SFSYNC_LIMIT');
  }
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z_]\w{0,63}$/.test(id))) {
    failSource('Adaptive state identities must be unique C# identifiers', method, 'SFSYNC_OWNERSHIP');
  }
  return {ids, marker: markers[0], comments: comments.filter(comment => comment !== markers[0] && comment.start > method.body.start)};
}
