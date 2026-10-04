import {DiagnosticId} from './diagnostics/codes.js';
import { checkFeatures, languageFeature } from '@sharpforge/syntax';
import { languageVersion } from './modern.js';
import { collectSyntaxFeatures } from './binder/syntax-features.js';
import { newestLanguageVersion } from './binder/feature-check.js';
import { misplacedTopLevelStatement } from './binder/top-level.js';
import { diagnostic } from '@sharpforge/text';
import { formatMessage } from './diagnostics/codes.js';

/** Features whose uses are taken from the syntax walk even when the parser recorded them too. */
const relocatedFeatures = new Set(['RecursivePatterns']);

/** CS8803 at the first top-level statement after a namespace or type declaration, with the span the analysis uses. */
function placementDiagnostics(file) {
  const statement = misplacedTopLevelStatement(file);
  if (!statement) return [];
  const { start, end } = statement.span;
  return [diagnostic(file.source, start, Math.max(1, end - start), DiagnosticId.CS8803, formatMessage(DiagnosticId.CS8803, []), 'error')];
}

/** Check original parsed files before async lowering, including reused workspace trees. */
export function syntaxFeatureChecks(files, options) {
  const diagnostics = [], unavailable = [], superseded = new Set();
  const key = d => d.uri + '|' + d.code + '|' + d.start + '|' + d.length;
  for (const file of files) {
    diagnostics.push(...placementDiagnostics(file));
    let selected;
    try { selected = languageVersion(options.langVersionByUri?.[file.source.uri] ?? options.langVersion); }
    catch { continue; } // Compilation reports invalid options once with CS1617.
    const located = file.syntax && selected.number < newestLanguageVersion ? collectSyntaxFeatures(file.syntax) : [];
    // The parser records these where it notices them (the clauses of a recursive pattern
    // without its type); the syntax walk knows Roslyn's location and the uses the parser does not record (a discard).
    const relocated = new Set(located.filter(use => relocatedFeatures.has(use.id)).map(use => use.id));
    const parsed = [...(file.features ?? [])], uses = parsed.filter(use => !relocated.has(use.id));
    for (const d of checkFeatures(file.source, parsed.filter(use => relocated.has(use.id)), selected)) superseded.add(key(d));
    const firstStatement = file.root.statements?.[0];
    if (firstStatement && !uses.some(use => use.id === 'TopLevelStatements')) {
      uses.push({ id: 'TopLevelStatements', start: firstStatement.start, end: firstStatement.end });
    }
    const recorded = new Set(uses.map(use => use.id));
    uses.push(...located.filter(use => !recorded.has(use.id)));
    diagnostics.push(...checkFeatures(file.source, uses, selected));
    for (const use of uses) {
      const feature = languageFeature(use.id);
      if (feature && (feature.preview ? !selected.preview : selected.number < feature.version)) {
        unavailable.push({uri: file.source.uri, start: use.start, end: use.end, version: feature.version});
      }
    }
  }
  for (const d of diagnostics) superseded.delete(key(d));
  /** True for a gate diagnostic of the parser that the syntax walk reports at another location. */
  const isSuperseded = d => superseded.has(key(d));
  return {diagnostics, unavailable, isSuperseded};
}
