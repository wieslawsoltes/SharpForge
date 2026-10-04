import {SemanticAnalysis} from './semantic-analysis.js';
import {SymbolKind} from './symbols/types.js';
import {forEachChild} from './bound/semantic-walker.js';

const referenceKey = (uri, token) => uri + ':' + token.span.start + ':' + token.span.end;
const original = symbol => symbol?.originalDefinition ?? symbol;
const namedToken = node => node?.identifier ?? node?.name?.identifier ?? node?.right?.identifier ?? null;

/** Bind source once and retain actual symbol identities, never textual guesses about what a name denotes. */
export function buildTypeRenameIndex(files, options, signal) {
  signal?.throwIfAborted();
  const analysis = new SemanticAnalysis(files, options);
  const result = analysis.run();
  const index = {analysis, result, references: new Map(), known: new Set(), files, unsupported: null};
  const remember = (uri, token, symbol, declaration = false) => {
    if (!token || !uri) return;
    const key = referenceKey(uri, token);
    index.known.add(key);
    if (symbol?.kind === SymbolKind.NamedType) {
      index.references.set(key, {uri, start: token.span.start, end: token.span.end, symbol: original(symbol), token, declaration});
    }
  };
  for (const type of result.assembly.types) {
    for (const declaration of type.declarations) remember(declaration.uri, declaration.syntax.identifier, type, true);
    for (const member of type.getMembers()) {
      const syntax = member.syntax;
      const uri = member.uri ?? member.locations?.[0]?.uri;
      const constructor = ['ConstructorDeclaration', 'DestructorDeclaration'].includes(syntax?.kind);
      remember(uri, namedToken(syntax), constructor ? type : member, constructor);
      for (const parameter of member.parameters ?? []) remember(uri, namedToken(parameter.syntax), parameter);
    }
  }
  for (const use of analysis.symbolUses ?? []) remember(use.uri, namedToken(use.node), use.symbol);
  for (const [owner, body] of result.bound) {
    const uri = body.binder?.c.uri ?? owner.uri ?? owner.locations?.[0]?.uri ?? owner.source?.uri;
    const stack = [body];
    const visited = new Set();
    while (stack.length) {
      signal?.throwIfAborted();
      const node = stack.pop();
      if (visited.has(node)) continue;
      visited.add(node);
      if (node.kind === 'TypeExpression') remember(uri, namedToken(node.syntax), node.referencedType);
      else if (node.kind === 'Local' || node.kind === 'Parameter') remember(uri, namedToken(node.syntax), node.local ?? node.parameter);
      forEachChild(node, child => stack.push(child));
    }
    for (const local of body.binder?.rootBinder.allLocals ?? []) remember(uri, namedToken(local.syntax) ?? local.syntax, local);
  }
  signal?.throwIfAborted();
  return index;
}

/** Unsupported reference-bearing trivia/aliases must be visible instead of silently omitted from a rename. */
export function unclassifiedTypeReferences(index, oldName, signal) {
  for (const file of index.files) {
    for (const token of file.syntax.descendantTokens()) {
      signal?.throwIfAborted();
      const parent = token.parent;
      if (parent?.kind === 'NameEquals' && parent.parent?.kind === 'UsingDirective') {
        return 'Type rename is unavailable while using aliases are present; alias references need their own binding coverage.';
      }
      for (const trivia of [...token.leadingTrivia, ...token.trailingTrivia]) {
        if (trivia.kind === 'DisabledTextTrivia' && trivia.text.trim()) {
          return 'Type rename is unavailable while inactive preprocessor source is present; its references are not bound.';
        }
        if (trivia.kind.includes('DocumentationComment') && /\bcref\s*=/.test(trivia.text)) {
          return 'Type rename is unavailable while documentation cref references are present; those references are not bound.';
        }
      }
      if (token.kind !== 'IdentifierToken' || token.valueText !== oldName) continue;
      if (index.known.has(referenceKey(file.source.uri, token))) continue;
      // These grammar positions declare value names; their spelling does not refer to a named type.
      const declaresValue = ['VariableDeclarator', 'Parameter', 'TypeParameter', 'SingleVariableDesignation', 'LabeledStatement']
        .includes(parent?.kind) && parent.identifier === token;
      if (!declaresValue) return `Type rename cannot prove the binding of '${oldName}' at ${file.source.uri}:${token.span.start}.`;
    }
  }
  return null;
}

/** A definition key independent of display names, used to detect binding capture after a rename. */
export function typeDefinitionKey(type, mapOffset = (uri, offset) => offset) {
  const declaration = type.declarations?.[0];
  if (!declaration) return type.toDisplayString();
  const token = declaration.syntax.identifier;
  return declaration.uri + ':' + mapOffset(declaration.uri, token.span.start);
}
