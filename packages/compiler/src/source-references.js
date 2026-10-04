import {symbolNameToken} from './source-symbols.js';

/** Classify the bound target, not receivers or argument subexpressions that happen to contain it. */
export function referenceAccess(syntax, declaration = false) {
  if (declaration) return {declaration: true, read: false, write: false, kind: 'definition'};
  let expression = syntax;
  for (;;) {
    if (expression?.parent?.kind === 'ParenthesizedExpression') expression = expression.parent;
    else if (expression?.parent?.kind === 'Argument' && expression.parent.parent?.kind === 'TupleExpression') {
      expression = expression.parent.parent;
    } else break;
  }
  const parent = expression?.parent;
  let read = true;
  let write = false;
  if (parent?.kind?.endsWith('AssignmentExpression') && parent.left === expression) {
    write = true;
    read = parent.kind !== 'SimpleAssignmentExpression';
  } else if (['PreIncrementExpression', 'PostIncrementExpression', 'PreDecrementExpression', 'PostDecrementExpression']
    .includes(parent?.kind)) write = true;
  else if (parent?.kind === 'Argument' && parent.expression === expression) {
    const modifier = parent.refKindKeyword?.text;
    write = modifier === 'ref' || modifier === 'out';
    read = modifier !== 'out';
  }
  return {declaration: false, read, write, kind: write ? 'write' : 'read'};
}

export function sourceReference(record, uri, syntax, source, declaration = false) {
  const token = symbolNameToken(syntax);
  if (!token || token.isMissing || token.valueText !== record.name) return null;
  const {start, end} = token.span;
  if (!source || start < 0 || end > source.length) return null;
  const position = source.positionAt(start);
  return {
    symbolId: record.id, uri, start, end, version: source.version, ...referenceAccess(syntax, declaration),
    line: position.line, character: position.character,
    definition: {uri: record.uri, start: record.start, end: record.end, name: record.name},
    definitionName: record.name,
  };
}
