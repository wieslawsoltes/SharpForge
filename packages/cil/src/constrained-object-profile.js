import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';
import {objectSlotDeclaration, objectSlotSignature, slotCache} from './object-slot-profile.js';

const primitives = new Map([
  ['System.Int32', Object.freeze({name: 'System.Int32', format: 'int'})],
  ['System.Int64', Object.freeze({name: 'System.Int64', format: 'long'})],
  ['System.UInt64', Object.freeze({name: 'System.UInt64', format: 'ulong'})]
]);
const primitiveNames = Object.freeze({int: 'System.Int32', long: 'System.Int64', ulong: 'System.UInt64'});

/** Metadata-only selection for sequential struct Object virtual calls.
 * Returns null outside this leaf; rejects ambiguous/explicit overrides with CilError.
 * Recreate after metadata edits. Selected targets and initializers still require body verification.
 */
export class ConstrainedObjectProfile {
  constructor(inspector) {
    this.inspector = inspector;
    this.types = new Map(inspector.types.map(type => [type.token, type]));
    this.names = new Map(inspector.types.map(type => [type.name, type]));
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
    this.primitiveTokens = new Map();
  }

  ordinaryInstanceSignature(token) {
    const row = this.inspector.metadata.row(token);
    // The display signature omits explicitThis; require the exact ordinary hasThis header.
    return this.inspector.metadata.blob(row[token >>> 24 === 6 ? 4 : 2])[0] === 0x20;
  }

  declaration(descriptor) {
    if (!objectSlotDeclaration(descriptor)) return null;
    if (!this.declarations.has(descriptor.token)) {
      if (!this.ordinaryInstanceSignature(descriptor.token)) throw new CilError(`Unsupported Object.${descriptor.name} calling convention`);
      this.declarations.add(descriptor.token);
    }
    return true;
  }

  primitiveType(typeToken) {
    if (typeof typeToken === 'string') return primitives.get(primitiveNames[typeToken] ?? typeToken) ?? null;
    if (typeToken >>> 24 !== 1) return null;
    if (!this.primitiveTokens.has(typeToken)) {
      this.primitiveTokens.set(typeToken, primitives.get(this.inspector.metadata.typeName(typeToken)) ?? null);
    }
    return this.primitiveTokens.get(typeToken);
  }

  /** Preserve the original Int32-only boolean query, including its unsupported-type behavior. */
  int32(typeToken, descriptor) {
    return this.primitiveType(typeToken)?.name === 'System.Int32' && !!this.declaration(descriptor);
  }

  /** Select one of the three explicit integer TypeRefs for the exact ordinary Object slot. */
  primitive(typeToken, descriptor) {
    const plan = this.primitiveType(typeToken);
    return plan && this.declaration(descriptor) ? plan : null;
  }

  rejectExplicit(typeToken, name = 'ToString') {
    for (const row of this.implementations.get(typeToken) ?? []) {
      const declaration = this.inspector.resolveToken(decodeCoded('MethodDefOrRef', row[2]));
      if (declaration.name === name && objectSlotDeclaration(declaration)) {
        throw new CilError(`Explicit Object.${name} MethodImpl is not implemented`);
      }
    }
  }

  virtualMethod(method, name = 'ToString') {
    if (method.name !== name || !(method.flags & 0x40) ||
        !objectSlotSignature(name, this.inspector.signature(method.token))) return false;
    if ((method.flags & 7) !== 6 || method.flags & 0x10 || this.genericOwners.has(method.token) ||
        !this.ordinaryInstanceSignature(method.token)) throw new CilError(`Unsupported Object.${name} override`);
    return true;
  }

  select(typeToken, descriptor) {
    if (!this.declaration(descriptor)) return null;
    return this.slot(typeToken, descriptor.name);
  }

  /** Ordinary Object.ToString selection used by synchronous framework callbacks. */
  valuePlan(typeToken) {
    return this.slot(typeToken, 'ToString');
  }

  /** Select a known Object slot for runtime field operations without synthesizing a metadata token. */
  slot(typeToken, name) {
    const plans = slotCache(this.plans, name);
    if (plans.has(typeToken)) return plans.get(typeToken);
    const type = this.types.get(typeToken);
    if (!type || (type.flags & 0x18) !== 8 || type.flags & 0x20 ||
        this.inspector.metadata.typeName(type.baseToken) !== 'System.ValueType') return null;
    this.rejectExplicit(typeToken, name);
    let target = null;
    const initializers = [];
    for (const method of type.methods) {
      if (method.name === '.cctor') {
        if (initializers.length) throw new CilError('Ambiguous type initializer');
        initializers.push(method.token);
      }
      if (method.flags & 0x100 || !this.virtualMethod(method, name)) continue;
      if (target) throw new CilError(`Ambiguous Object.${name} override`);
      target = method.token;
    }
    const plan = Object.freeze({target, initializers: Object.freeze(initializers)});
    plans.set(typeToken, plan);
    return plan;
  }
}
