/** Freeze an owned signature AST after bounded decoding. */
export function freezeSignature(node) {
  if (!node || typeof node !== 'object' || Object.isFrozen(node)) return node;
  for (const value of Object.values(node)) freezeSignature(value);
  return Object.freeze(node);
}
