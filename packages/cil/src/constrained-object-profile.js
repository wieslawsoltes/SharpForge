import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';

function toStringSignature(signature) {
  return signature && !signature.isStatic && !signature.genericArity && !signature.callingConvention &&
    signature.parameters.length === 0 && (signature.returnType === 'string' || signature.returnType === 'System.String');
}

function objectToString(descriptor) {
  return descriptor.kind === 'method' && descriptor.owner === 'System.Object' && descriptor.name === 'ToString' &&
    descriptor.ownerToken >>> 24 === 1 &&
    !descriptor.resolvedToken && descriptor.token >>> 24 === 10 && descriptor.definitionToken >>> 24 !== 6 &&
    !descriptor.methodArguments?.length && !descriptor.typeArguments?.length && toStringSignature(descriptor.signature);
}

/** Metadata-only selection for concrete sequential struct Object.ToString calls.
 * Returns null outside this leaf; rejects ambiguous/explicit overrides with CilError.
 * Recreate after metadata edits. Selected targets and initializers still require body verification.
 */
export class ConstrainedObjectProfile {
  constructor(inspector) {
    this.inspector = inspector;
    this.types = new Map(inspector.types.map(type => [type.token, type]));
    this.genericOwners = new Set((inspector.metadata.rows[42] ?? [])
      .map(row => decodeCoded('TypeOrMethodDef', row[2])));
    this.implementations = new Map();
    for (const row of inspector.metadata.rows[25] ?? []) {
      const owner = 0x02000000 | row[0];
      if (!this.implementations.has(owner)) this.implementations.set(owner, []);
      this.implementations.get(owner).push(row);
    }
    this.plans = new Map();
    this.declarations = new Set();
    this.int32Tokens = new Map();
  }

  ordinaryInstanceSignature(token) {
    const row = this.inspector.metadata.row(token);
    // The display signature omits explicitThis; require the exact ordinary hasThis header.
    return this.inspector.metadata.blob(row[token >>> 24 === 6 ? 4 : 2])[0] === 0x20;
  }

  declaration(descriptor) {
    if (!objectToString(descriptor)) return null;
    if (!this.declarations.has(descriptor.token)) {
      if (!this.ordinaryInstanceSignature(descriptor.token)) throw new CilError('Unsupported Object.ToString calling convention');
      this.declarations.add(descriptor.token);
    }
    return true;
  }

  /** Admit only the concrete external Int32 TypeRef and the exact ordinary Object slot. */
  int32(typeToken, descriptor) {
    if (typeToken >>> 24 !== 1) return false;
    if (!this.int32Tokens.has(typeToken)) {
      this.int32Tokens.set(typeToken, this.inspector.metadata.typeName(typeToken) === 'System.Int32');
    }
    return this.int32Tokens.get(typeToken) && !!this.declaration(descriptor);
  }

  rejectExplicit(typeToken) {
    for (const row of this.implementations.get(typeToken) ?? []) {
      const declaration = this.inspector.resolveToken(decodeCoded('MethodDefOrRef', row[2]));
      if (objectToString(declaration)) throw new CilError('Explicit Object.ToString MethodImpl is not implemented');
    }
  }

  virtualMethod(method) {
    if (method.name !== 'ToString' || !(method.flags & 0x40) ||
        !toStringSignature(this.inspector.signature(method.token))) return false;
    if ((method.flags & 7) !== 6 || method.flags & 0x10 || this.genericOwners.has(method.token) ||
        !this.ordinaryInstanceSignature(method.token)) throw new CilError('Unsupported Object.ToString override');
    return true;
  }

  select(typeToken, descriptor) {
    if (!this.declaration(descriptor)) return null;
    if (this.plans.has(typeToken)) return this.plans.get(typeToken);
    const type = this.types.get(typeToken);
    if (!type || (type.flags & 0x18) !== 8 || type.flags & 0x20 || this.genericOwners.has(typeToken) ||
        this.inspector.metadata.typeName(type.baseToken) !== 'System.ValueType') return null;
    this.rejectExplicit(typeToken);
    let target = null;
    const initializers = [];
    for (const method of type.methods) {
      if (method.name === '.cctor') {
        if (initializers.length) throw new CilError('Ambiguous type initializer');
        initializers.push(method.token);
      }
      if (method.flags & 0x100 || !this.virtualMethod(method)) continue;
      if (target) throw new CilError('Ambiguous Object.ToString override');
      target = method.token;
    }
    const plan = Object.freeze({target, initializers: Object.freeze(initializers)});
    this.plans.set(typeToken, plan);
    return plan;
  }
}
