function sameSignature(left, right) {
  return left?.kind === 'Method' && right?.kind === 'Method' && left.name === right.name &&
    left.isStatic === right.isStatic && left.returnType?.equals(right.returnType) &&
    left.parameters.length === right.parameters.length && left.parameters.every((parameter, index) =>
      parameter.refKind === right.parameters[index].refKind && parameter.type?.equals(right.parameters[index].type));
}

/** A legacy builtin aliases an identical registered member instead of creating an ambiguous overload. */
export function appendRegistryBuiltin(bridge, members, symbol, builtin) {
  const existing = members.find(member => symbol.kind === 'Property' ?
    member.kind === 'Property' && member.name === symbol.name && sameSignature(member.getMethod, symbol.getMethod) :
    sameSignature(member, symbol));
  if (existing) {
    bridge.builtinSymbols.set(builtin.id, existing.kind === 'Property' ? existing.getMethod : existing);
    return;
  }
  symbol.builtin = builtin;
  bridge.builtinSymbols.set(builtin.id, symbol.kind === 'Property' ? symbol.getMethod : symbol);
  members.push(symbol);
  if (symbol.kind === 'Property') members.push(symbol.getMethod);
}
