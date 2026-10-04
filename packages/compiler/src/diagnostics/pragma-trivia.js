/**
 * `#pragma warning` directives of parsed files, as `compile()` applies them (SF-A02-T37).
 *
 * The parser records every directive as trivia and says which ones are in active code. What a `#pragma warning`
 * line means - its action, its ids and the warnings of a malformed line (CS1633, CS1634, CS1072, CS1696 with the
 * span of the offending token) - is decided by the Roslyn-pinned scanner of ./suppression.js, run on the text of
 * each active pragma line only. In particular `#pragma warning enable` is not a directive Roslyn knows: it is
 * CS1634 and changes nothing.
 *
 * The parser's own diagnostics for those lines are replaced by the scanner's, so each malformed line is reported
 * once, with Roslyn's span.
 */
import {DiagnosticId} from './codes.js';
import { parsePragmaDirectives } from './suppression.js';

const pragmaCodes = new Set([DiagnosticId.CS1633, DiagnosticId.CS1634, DiagnosticId.CS1072, DiagnosticId.CS1696]);

/** The active `#pragma` directive trivia of a parsed file. */
function activePragmas(file) {
  return (file.directives ?? []).filter(d => d.structure?.directive === 'pragma' && d.structure.isActive !== false);
}

/**
 * @param {object[]} files parsed files (`source`, `directives`)
 * @returns {{byUri: Map<string, {directives: object[], diagnostics: object[]}>, withoutParserDiagnostics(list): object[]}}
 *   `byUri`: per file, the pragma directives (`{start,end,action,ids}`) and directive warnings (`{code,args,start,length}`)
 *   in file offsets; `withoutParserDiagnostics` removes the parser's diagnostics for pragma lines from a list.
 */
export function pragmaWarningsOf(files) {
  const byUri = new Map(),
    spans = new Map();
  for (const file of files) {
    const pragmas = activePragmas(file);
    if (!file.directives) continue;
    const entry = { directives: [], diagnostics: [] },
      text = file.source.text;
    for (const pragma of pragmas) {
      const scanned = parsePragmaDirectives(text.slice(pragma.start, pragma.end));
      for (const d of scanned.directives) entry.directives.push({ ...d, start: d.start + pragma.start, end: d.end + pragma.start });
      for (const d of scanned.diagnostics) entry.diagnostics.push({ ...d, start: d.start + pragma.start });
    }
    byUri.set(file.source.uri, entry);
    if (pragmas.length) spans.set(file.source.uri, pragmas);
  }
  const isParserPragmaDiagnostic = d =>
    pragmaCodes.has(d.code) && (spans.get(d.uri) ?? []).some(pragma => pragma.start <= d.start && d.start < pragma.end);
  return {
    byUri,
    withoutParserDiagnostics: list => (spans.size ? list.filter(d => !isParserPragmaDiagnostic(d)) : list),
  };
}
