/** The dotted path of a name or member-access chain (`A.B.C`), or null. Linear in the length of the chain. */
export function memberPath(node) {
  if (node?.kind === 'Name') return node.name;
  if (node?.kind !== 'Member') return null;
  const target = memberPath(node.target);
  return target ? target + '.' + node.name : null;
}
