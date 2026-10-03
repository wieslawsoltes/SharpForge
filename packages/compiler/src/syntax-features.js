import { checkFeatures, languageFeature } from '@sharpforge/syntax';
import { languageVersion } from './modern.js';

/** Check original parsed files before async lowering, including reused workspace trees. */
export function syntaxFeatureChecks(files, options) {
  const diagnostics = [], unavailable = [];
  for (const file of files) {
    let selected;
    try { selected = languageVersion(options.langVersionByUri?.[file.source.uri] ?? options.langVersion); }
    catch { continue; } // Compilation reports invalid options once with SF2140.
    const uses = [...(file.features ?? [])];
    const firstStatement = file.root.statements?.[0];
    if (firstStatement && !uses.some(use=>use.id==='TopLevelStatements')) uses.push({id:'TopLevelStatements',start:firstStatement.start,end:firstStatement.end});
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
