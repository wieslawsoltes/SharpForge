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
      const before = start > 1 && /[\uDC00-\uDFFF]/u.test(text[start - 1]) ? text.slice(start - 2, start) : text[start - 1] ?? '';
      const after = end < text.length ? String.fromCodePoint(text.codePointAt(end)) : '';
      if (options.wholeWord && (word.test(before) || word.test(after))) continue;
      if (matches.length === maximum) return {matches, scannedFiles, truncated: true};
      for (let index = scanned; index < start; index++) {
        if (text[index] === '\n') { line++; lineStart = index + 1; }
      }
      scanned = start;
      const lineEnd = text.indexOf('\n', start);
      const replacement = options.replacement === undefined ? undefined : options.regex ?
        expandReplacement(String(options.replacement), match, text) : String(options.replacement);
      matches.push({id: document.uri + ':' + document.version + ':' + start, uri: document.uri,
        projectId: document.projectId, version: document.version, start, end, line, character: start - lineStart,
        preview: text.slice(lineStart, Math.min(lineEnd < 0 ? text.length : lineEnd, lineStart + 400)),
        matchedText: match[0], replacement});
    }
    options.onProgress?.({scannedFiles, matches: matches.length});
  }
  return {matches, scannedFiles, truncated: false};
}

/** Native replacement substitutions use the original match context, including lookarounds and named groups. */
export function expandReplacement(replacement, match, source) {
  return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/gu, (token, part) => {
    if (part === '$') return '$';
    if (part === '&') return match[0];
    if (part === '`') return source.slice(0, match.index);
    if (part === "'") return source.slice(match.index + match[0].length);
    if (part[0] === '<') return match.groups ? match.groups[part.slice(1, -1)] ?? '' : token;
    const capture = Number(part);
    if (capture > 0 && capture < match.length) return match[capture] ?? '';
    const first = Number(part[0]);
    if (part.length === 2 && first > 0 && first < match.length) return (match[first] ?? '') + part[1];
    return token;
  });
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
