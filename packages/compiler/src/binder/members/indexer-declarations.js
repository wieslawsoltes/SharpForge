/**
 * Declaration rules of indexers (SF-A02-T10.2), as Roslyn reports them:
 *
 *   CS0106  an indexer cannot be static                    CS1551  an indexer needs at least one parameter
 *   CS0631  ref and out parameters are not allowed         CS0111  two indexers with the same parameter types
 *
 * Returns `{ member, code, args, at? }` rows: `at` is the syntax to report at when it is not the `this` keyword.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, RefKind } from '../../symbols/types.js';

// An indexer declared without parameters is still an indexer declaration (its symbol has no parameters).
const isIndexer = member => member.kind === SymbolKind.Property && (member.isIndexer || member.syntax?.kind === 'IndexerDeclaration');
const signatureOf = indexer => indexer.parameters.map(p => (p.refKind === RefKind.None ? '' : 'ref ') + (p.type?.toDisplayString() ?? '?')).join(',');
const byRefKeywords = new Set(['ref', 'out']);

/** Checks the indexers a type declares; explicit interface implementations are compared per interface. */
export function checkIndexerDeclarations(type) {
  const rows = [],
    signatures = new Set();
  for (const indexer of type.getMembers().filter(isIndexer)) {
    const syntax = indexer.syntax,
      list = syntax?.parameterList;
    if (indexer.isStatic) rows.push({ member: indexer, code: DiagnosticId.CS0106, args: ['static'] });
    if (list && !indexer.parameters.length) rows.push({ member: indexer, code: DiagnosticId.CS1551, args: [], at: list.closeBracketToken });
    for (const parameter of indexer.parameters) {
      if (parameter.refKind !== RefKind.Ref && parameter.refKind !== RefKind.Out) continue;
      const keyword = parameter.syntax?.modifiers?.find(token => byRefKeywords.has(token.text));
      rows.push({ member: indexer, code: DiagnosticId.CS0631, args: [], at: keyword ?? parameter.syntax });
    }
    const key = (indexer.explicitInterfaceSyntax ? indexer.name : 'this') + '[' + signatureOf(indexer) + ']';
    if (signatures.has(key) && indexer.parameters.length) rows.push({ member: indexer, code: DiagnosticId.CS0111, args: ['this', type.toDisplayString()] });
    signatures.add(key);
  }
  return rows;
}
