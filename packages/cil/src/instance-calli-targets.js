import {decodeCoded} from './metadata.js';

/** Metadata-only eligibility for direct ldftn instance calls; recreate when metadata changes. */
export class InstanceCalliTargets {
  constructor(inspector) {
    this.inspector = inspector;
    this.genericOwners = new Set((inspector.metadata.rows[42] ?? []).map(row => decodeCoded('TypeOrMethodDef', row[2])));
    this.targets = new Map();
  }

  accepts(token) {
    if (this.targets.has(token)) return this.targets.get(token);
    const method = this.inspector.methods.get(token);
    if (!method) return false;
    const accepted = this.check(method);
    this.targets.set(token, accepted);
    return accepted;
  }

  check(method) {
    if (!method.hasBody || method.flags & (0x10 | 0x400) || this.genericOwners.has(method.token) ||
        method.name === '.ctor' || method.name === '.cctor') return false;
    const owner = this.inspector.types[(method.ownerToken & 0xffffff) - 1];
    if (!owner || owner.token !== method.ownerToken || owner.flags & 0x20 || this.genericOwners.has(owner.token)) return false;
    const metadata = this.inspector.metadata;
    const base = owner.baseToken ? metadata.typeName(owner.baseToken) : null;
    if (!base || base === 'System.ValueType' || base === 'System.Enum') return false;
    // Require ordinary managed HasThis, including the flags lost by inspection formatting.
    return metadata.blob(metadata.row(method.token)[4])[0] === 0x20;
  }
}
