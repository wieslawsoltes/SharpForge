import {SourceText} from '@sharpforge/text';

/** Uses the language lexer so TODO-like strings do not become comment tasks. */
export async function scanCommentTasks(documents, tokens, {signal, onProgress = () => {}} = {}) {
  const {lex} = await import('@sharpforge/syntax');
  const tokenMap = new Map(tokens.map(item => [item.token, item.priority]));
  const pattern = new RegExp('\\b(' + [...tokenMap.keys()].join('|') + ')\\b\\s*:?\\s*([^\\r\\n]*)', 'gu');
  const result = [];
  if (!tokenMap.size) return result;
  for (const [index, document] of documents.entries()) {
    signal?.throwIfAborted();
    const source = new SourceText(document.text, document.uri, document.version);
    const syntax = lex(source);
    const seen = new Set();
    for (const token of syntax.tokens) {
      for (const trivia of [...token.leadingTrivia, ...token.trailingTrivia]) {
        if (!trivia.kind.includes('Comment') || seen.has(trivia.start)) continue;
        seen.add(trivia.start);
        const text = source.text.slice(trivia.start, trivia.end);
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) {
          const start = trivia.start + match.index;
          const position = source.positionAt(start);
          result.push({id: document.uri + ':' + start, uri: document.uri, version: document.version,
            projectId: document.projectId, start, end: start + match[0].length, line: position.line + 1,
            priority: tokenMap.get(match[1]), token: match[1], description: match[2].replace(/\*\/$/u, '').trim(), kind: 'comment'});
        }
      }
    }
    onProgress(index + 1);
    if (result.length > 100000) throw new RangeError('Task List limit exceeded');
    if (index % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return result;
}
