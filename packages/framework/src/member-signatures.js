/** Normalize the scalar Decimal spelling only at member-signature boundaries; owners and compound types stay unchanged. */
export function memberSignatureType(type) {
  return type === 'System.Decimal' ? 'decimal' : type;
}

/** Bind the existing nearest-member query to exact scalar signature matching without changing registry type identity. */
export function createContractResolver(findContracts, canonicalType) {
  const signatureType = type => memberSignatureType(canonicalType(type));
  const sameType = (left, right) => left === right || signatureType(left) === signatureType(right);
  return descriptor => {
    if (!descriptor?.signature) return null;
    const owner = canonicalType(descriptor.owner);
    const signature = descriptor.signature;
    return findContracts(owner, descriptor.name, signature.isStatic).find(contract =>
      contract.parameters.length === signature.parameters.length &&
      contract.parameters.every((type, index) => sameType(type, signature.parameters[index])) &&
      sameType(contract.kind === 'constructor' ? 'void' : contract.result, signature.returnType)) ?? null;
  };
}
