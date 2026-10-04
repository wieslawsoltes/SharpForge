/** Bound overload mapping supplies parameter hints, including named and extension method argument ordering. */
export function argumentHints(node, uri, source) {
  if (!['Call', 'ObjectCreation', 'IndexerAccess'].includes(node.kind) || node.hasErrors) return [];
  const result = [];
  for (const argument of node.args ?? []) {
    const expression = argument.expression;
    const syntax = expression?.syntax;
    const parameter = argument.parameter;
    if (!syntax || !parameter?.name || parameter.name.startsWith('<')) continue;
    let argumentSyntax = syntax;
    while (argumentSyntax && argumentSyntax.kind !== 'Argument' && argumentSyntax !== node.syntax) {
      argumentSyntax = argumentSyntax.parent;
    }
    // Extension receivers, omitted optional arguments, and explicit named arguments get no redundant hint.
    if (argumentSyntax?.kind !== 'Argument' || argumentSyntax.nameColon) continue;
    const offset = argumentSyntax.expression?.span?.start ?? syntax.span.start;
    if (offset < 0 || offset > source.length) continue;
    result.push({uri, offset, position: source.positionAt(offset), label: parameter.name + ':',
      kind: 2, paddingRight: true, paddingLeft: false, parameter: parameter.name});
  }
  return result;
}
