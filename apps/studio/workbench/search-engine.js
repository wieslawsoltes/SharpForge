/** Worker-side bounded search; the host terminates the worker for regex cancellation or timeout. */
export function searchDocuments(documents, query, options = {}) {
  if (!Array.isArray(documents) || documents.length > 100000) throw new RangeError('Search document limit exceeded');
  if (typeof query !== 'string' || query.length > 1024) throw new RangeError('Search query must be at most 1024 characters');
  const maximum = options.maxMatches ?? 100000;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100000) throw new RangeError('Invalid search result limit');
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(options.regex ? query : escape(query), options.matchCase ? 'gu' : 'giu');
  const word = /[\p{L}\p{N}\p{M}_]/u;
  const matches = [];
  let scannedFiles = 0;
  let characters = 0;
  if (!query) return {matches, scannedFiles, truncated: false};
  for (const document of documents) {
    if (typeof document.text !== 'string' || typeof document.uri !== 'string') throw new TypeError('Invalid search document');
    characters += document.text.length;
    if (characters > 100_000_000) throw new RangeError('Search text exceeds 100 million UTF-16 units');
    scannedFiles++;
    const text = document.text;
    pattern.lastIndex = 0;
    let match, line = 0, lineStart = 0, scanned = 0;
    while ((match = pattern.exec(text))) {
      const start = match.index, end = start + match[0].length;
      if (!match[0].length) {
        const point = text.codePointAt(pattern.lastIndex);
        pattern.lastIndex += point > 0xffff ? 2 : 1;
      }
      if (options.wholeWord && (word.test(text.slice(Math.max(0, start - 1), start)) || word.test(text.slice(end, end + 1)))) continue;
      if (matches.length === maximum) return {matches, scannedFiles, truncated: true};
      for (let index = scanned; index < start; index++) {
        if (text[index] === '\n') { line++; lineStart = index + 1; }
      }
      scanned = start;
      const lineEnd = text.indexOf('\n', start);
      const replacement = options.replacement === undefined ? undefined : match[0].replace(
        new RegExp(options.regex ? query : escape(query), options.matchCase ? 'u' : 'iu'), options.replacement);
      matches.push({id: document.uri + ':' + document.version + ':' + start, uri: document.uri,
        projectId: document.projectId, version: document.version, start, end, line, character: start - lineStart,
        preview: text.slice(lineStart, Math.min(lineEnd < 0 ? text.length : lineEnd, lineStart + 400)),
        matchedText: match[0], replacement});
    }
    options.onProgress?.({scannedFiles, matches: matches.length});
  }
  return {matches, scannedFiles, truncated: false};
}

/** Glob matching compiles wildcard path components, independent of source language. */
export function compileFileGlobs(globs = '*') {
  if (typeof globs !== 'string' || globs.length > 2048) throw new TypeError('Invalid file globs');
  const patterns = globs.split(/[;,]/u).map(item => item.trim()).filter(Boolean).map(glob => {
    let pattern = '';
    for (let index = 0; index < glob.length; index++) {
      const character = glob[index];
      if (character === '*') pattern += '.*';
      else if (character === '?') pattern += '.';
      else pattern += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + pattern + '$', 'iu');
  });
  return uri => !patterns.length || patterns.some(pattern => pattern.test(uri) || pattern.test(uri.split(/[\\/]/u).at(-1)));
}
