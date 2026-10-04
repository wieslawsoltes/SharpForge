import {forEachChild} from '../bound/semantic-walker.js';

/** Source identities in a bound nameof operand; retaining these does not make its operand executable. */
export function namedSourceReferences(operand) {
  const references = [];
  const visited = new Set();
  const pending = [operand];
  while (pending.length) {
    const node = pending.pop();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    const symbol = node.local ?? node.parameter ?? node.field ?? node.property ?? node.event ?? node.referencedType ??
      (node.methods?.length === 1 ? node.methods[0] : null);
    if (symbol) references.push({symbol, syntax: node.syntax});
    forEachChild(node, child => pending.push(child));
  }
  return references;
}
