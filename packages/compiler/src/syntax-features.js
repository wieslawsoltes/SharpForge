import {DiagnosticId} from './diagnostics/codes.js';
import { checkFeatures, languageFeature } from '@sharpforge/syntax';
import { languageVersion } from './modern.js';
import { collectSyntaxFeatures } from './binder/syntax-features.js';
import { newestLanguageVersion } from './binder/feature-check.js';
import { misplacedTopLevelStatement } from './binder/top-level.js';
import { diagnostic } from '@sharpforge/text';
import { formatMessage } from './diagnostics/codes.js';

/** CS8803 at the first top-level statement after a namespace or type declaration, with the span the analysis uses. */
function placementDiagnostics(file) {
  const statement = misplacedTopLevelStatement(file);
  if (!statement) return [];
  const { start, end } = statement.span;
  return [diagnostic(file.source, start, Math.max(1, end - start), DiagnosticId.CS8803, formatMessage(DiagnosticId.CS8803, []), 'error')];
}

/** Check original parsed files before async lowering, including reused workspace trees. */
export function syntaxFeatureChecks(files, options) {
  const diagnostics = [], unavailable = [];
  for (const file of files) {
    diagnostics.push(...placementDiagnostics(file));
    let selected;
    try { selected = languageVersion(options.langVersionByUri?.[file.source.uri] ?? options.langVersion); }
    catch { continue; } // Compilation reports invalid options once with CS1617.
    const uses = [...(file.features ?? [])];
    const firstStatement = file.root.statements?.[0];
    if (firstStatement && !uses.some(use => use.id === 'TopLevelStatements')) {
      uses.push({ id: 'TopLevelStatements', start: firstStatement.start, end: firstStatement.end });
    }
    if (file.syntax && selected.number < newestLanguageVersion) {
      const recorded = new Set(uses.map(use => use.id));
      uses.push(...collectSyntaxFeatures(file.syntax).filter(use => !recorded.has(use.id)));
    }
    diagnostics.push(...checkFeatures(file.source, uses, selected));
    for (const use of uses) {
      const feature = languageFeature(use.id);
      if (feature && (feature.preview ? !selected.preview : selected.number < feature.version)) {
        unavailable.push({uri: file.source.uri, start: use.start, end: use.end, version: feature.version});
      }
    }
  }
  return {diagnostics, unavailable};
}
