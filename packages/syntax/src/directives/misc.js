/** #error, #warning, #line, #pragma and #nullable directives, plus the #line position map. #region/#endregion share the conditional stack (conditional.js). */
const comment = /^[ \t]*(?:\/\/.*)?$/,
  quoted = /^[ \t]*"([^"]*)"/;
const extra = rest => (comment.test(rest) ? [] : [['CS1025', 'Single-line comment or end-of-line expected']]);
function lineDirective(rest) {
  const word = /^[ \t]*(default|hidden)(?![\w])(.*)$/.exec(rest);
  if (word) return { structure: { directive: 'line', mode: word[1] }, diagnostics: extra(word[2]) };
  const span = /^[ \t]*\([ \t]*(\d+)[ \t]*,[ \t]*(\d+)[ \t]*\)[ \t]*-[ \t]*\([ \t]*(\d+)[ \t]*,[ \t]*(\d+)[ \t]*\)(?:[ \t]+(\d+))?(.*)$/.exec(rest);
  if (span) {
    // Roslyn has no language-version gate for the span form, so no feature use is recorded for it.
    const file = quoted.exec(span[6]),
      diagnostics = file ? extra(span[6].slice(file[0].length)) : [['CS8938', 'The #line directive value is missing or out of range']];
    const n = k => Number(span[k]);
    if ([1, 2, 3, 4].some(k => n(k) < 1 || n(k) > 16707566) || n(3) < n(1) || (n(3) === n(1) && n(4) < n(2)))
      diagnostics.push(['CS8939', 'The #line directive end position must be greater than or equal to the start position']);
    return {
      kind: 'LineSpanDirectiveTrivia',
      structure: {
        directive: 'line',
        mode: 'span',
        start: { line: n(1), character: n(2) },
        end: { line: n(3), character: n(4) },
        characterOffset: span[5] === undefined ? null : n(5),
        file: file?.[1] ?? null
      },
      diagnostics
    };
  }
  const number = /^[ \t]*(\d+)(.*)$/.exec(rest);
  if (!number)
    return {
      structure: { directive: 'line', mode: 'invalid' },
      diagnostics: [['CS1576', 'The line number specified for #line directive is missing or invalid']]
    };
  const file = quoted.exec(number[2]),
    tail = file ? number[2].slice(file[0].length) : number[2],
    diagnostics = file || comment.test(tail) ? extra(tail) : [['CS1578', 'Quoted file name, single-line comment or end-of-line expected']];
  if (Number(number[1]) < 1 || Number(number[1]) > 16707566)
    diagnostics.push(['CS1576', 'The line number specified for #line directive is missing or invalid']);
  return { structure: { directive: 'line', mode: 'number', line: Number(number[1]), file: file?.[1] ?? null }, diagnostics };
}
const checksumSyntax = 'Invalid #pragma checksum syntax; should be #pragma checksum "filename" "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" "XXXX..."';
/** [offset, length] of the first word of `text` (which starts `base` characters into the directive), or of its end when it has none. */
function wordSpan(text, base) {
  const word = /^[ \t]*([^\s\/]+)/.exec(text);
  return word ? [base + word[0].length - word[1].length, word[1].length] : [base, 0];
}
/**
 * `#pragma warning disable|restore [codes]` and `#pragma checksum "file" "{guid}" "bytes"`. `base` is the offset of
 * `rest` within the directive; each warning names the offending word (or the place where one is missing), as in Roslyn.
 */
function pragmaDirective(rest, features, base) {
  features.push('Pragma');
  const warning = /^[ \t]*warning(?![\w])(.*)$/.exec(rest);
  if (warning) {
    const afterWarning = base + rest.length - warning[1].length,
      action = /^[ \t]*(disable|restore)(?![\w])(.*)$/.exec(warning[1]);
    if (!action)
      return {
        kind: 'PragmaWarningDirectiveTrivia',
        structure: { directive: 'pragma', pragma: 'warning', action: null, codes: [] },
        diagnostics: [['CS1634', 'Expected disable or restore', 'warning', wordSpan(warning[1], afterWarning)]]
      };
    const list = action[2].replace(/\/\/.*$/, '').trim(),
      codes = list ? list.split(',').map(c => c.trim()) : [];
    const bad = codes.some(c => !/^(?:\d+|[A-Za-z_]\w*)$/.test(c));
    return {
      kind: 'PragmaWarningDirectiveTrivia',
      structure: {
        directive: 'pragma',
        pragma: 'warning',
        action: action[1],
        codes: codes.map(c => (/^\d+$/.test(c) ? 'CS' + c.padStart(4, '0') : c))
      },
      diagnostics: bad ? [['CS1072', 'Expected identifier or numeric literal', 'warning']] : []
    };
  }
  const checksum = /^[ \t]*checksum(?![\w])[ \t]*"([^"]*)"[ \t]*"([^"]*)"[ \t]*"([^"]*)"(.*)$/.exec(rest);
  if (checksum) {
    const valid = /^\{[\da-fA-F]{8}-(?:[\da-fA-F]{4}-){3}[\da-fA-F]{12}\}$/.test(checksum[2]) && /^(?:[\da-fA-F]{2})*$/.test(checksum[3]);
    return {
      kind: 'PragmaChecksumDirectiveTrivia',
      structure: { directive: 'pragma', pragma: 'checksum', file: checksum[1], guid: checksum[2], bytes: checksum[3] },
      diagnostics: valid ? extra(checksum[4]) : [['CS1695', checksumSyntax, 'warning']]
    };
  }
  const bare = /^[ \t]*checksum(?![\w])/.exec(rest);
  if (bare)
    return {
      kind: 'PragmaChecksumDirectiveTrivia',
      structure: { directive: 'pragma', pragma: 'checksum', file: null, guid: null, bytes: null },
      diagnostics: [['CS1695', checksumSyntax, 'warning', [base + bare[0].length, 0]]]
    };
  return {
    kind: 'PragmaWarningDirectiveTrivia',
    structure: { directive: 'pragma', pragma: null },
    diagnostics: [['CS1633', 'Unrecognized #pragma directive', 'warning', wordSpan(rest, base)]]
  };
}
export function scanMiscDirective(name, rest, features = [], base = 0) {
  if (name === 'error')
    return {
      kind: 'ErrorDirectiveTrivia',
      structure: { directive: 'error', message: rest.trim() },
      diagnostics: [['CS1029', `#error: '${rest.trim()}'`]]
    };
  if (name === 'warning')
    return {
      kind: 'WarningDirectiveTrivia',
      structure: { directive: 'warning', message: rest.trim() },
      diagnostics: [['CS1030', `#warning: '${rest.trim()}'`, 'warning']]
    };
  if (name === 'line') return { kind: 'LineDirectiveTrivia', ...lineDirective(rest) };
  if (name === 'pragma') return pragmaDirective(rest, features, base);
  if (name === 'nullable') {
    features.push('NullableReferenceTypes');
    const setting = /^[ \t]*(enable|disable|restore)(?![\w])(.*)$/.exec(rest);
    if (!setting)
      return {
        kind: 'NullableDirectiveTrivia',
        structure: { directive: 'nullable', setting: null, target: null },
        diagnostics: [['CS8637', "Expected 'enable', 'disable', or 'restore'"]]
      };
    const target = /^[ \t]*(annotations|warnings)(?![\w])(.*)$/.exec(setting[2]);
    const diagnostics = target
      ? extra(target[2])
      : comment.test(setting[2])
        ? []
        : [['CS8638', "Expected 'warnings', 'annotations', or end of directive"]];
    return { kind: 'NullableDirectiveTrivia', structure: { directive: 'nullable', setting: setting[1], target: target?.[1] ?? null }, diagnostics };
  }
  return null;
}
/**
 * Builds a position mapper from the #line directives of a lexed file. `directives` are the lexer's directive trivia
 * (each with start, end and structure). map(offset) returns { line, character, path, hidden } with zero-based
 * line/character, applying `#line N "file"`, `#line hidden`, `#line default` and the C# 10 span form.
 */
export function createLineMap(source, directives = []) {
  const entries = directives
    .filter(d => d.structure?.directive === 'line' && d.structure.mode !== 'invalid' && d.structure.isActive !== false)
    .map(d => ({ ...d.structure, from: source.positionAt(d.end).line, at: d.end }))
    .sort((a, b) => a.at - b.at);
  return {
    entries,
    map(offset) {
      const position = source.positionAt(offset);
      let entry = null;
      for (const candidate of entries) {
        if (candidate.at > offset) break;
        entry = candidate;
      }
      if (!entry || entry.mode === 'default') return { line: position.line, character: position.character, path: source.uri, hidden: false };
      if (entry.mode === 'hidden') return { line: position.line, character: position.character, path: source.uri, hidden: true };
      const path = entry.file ?? [...entries].reverse().find(e => e.at <= entry.at && e.file)?.file ?? source.uri,
        delta = position.line - entry.from;
      if (entry.mode === 'span') {
        const first = delta === 0,
          offsetColumns = entry.characterOffset ?? 0;
        return {
          line: entry.start.line - 1 + delta,
          character: first ? Math.max(0, position.character - offsetColumns) + entry.start.character - 1 : position.character,
          path,
          hidden: false
        };
      }
      return { line: entry.line - 1 + delta, character: position.character, path, hidden: false };
    }
  };
}
