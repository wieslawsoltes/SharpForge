import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';

const rootSlot = Object.freeze({first: null, anchor: null, target: null, depth: 0});

/** Nongeneric reference hierarchy selection using the existing internal virtual slots.
 * A bounded child index supplies reachable targets; no external Object vtable is synthesized.
 */
export class ConstrainedReferenceObjectProfile {
  constructor(inspector, objects, dispatch) {
    this.inspector = inspector;
    this.objects = objects;
    this.dispatch = dispatch;
    this.plans = new Map();
    this.reachable = new Map();
    this.parents = new Map();
    this.children = new Map();
    this.remaining = 262_144;
    this.charge(inspector.types.length);
    const names = new Map(inspector.types.map(type => [type.name, type.token]));
    for (const type of inspector.types) {
      let parent = null;
      if (type.baseToken >>> 24 === 2) parent = type.baseToken;
      else if (type.baseToken >>> 24 === 1) {
        const name = inspector.metadata.typeName(type.baseToken);
        parent = names.get(name) ?? (name === 'System.Object' ? 0 : null);
      }
      this.parents.set(type.token, parent);
      if (!this.children.has(parent)) this.children.set(parent, []);
      this.children.get(parent).push(type.token);
    }
  }

  charge(count = 1) {
    this.remaining -= count;
    if (this.remaining < 0) throw new CilError('Constrained Object selection exceeds its metadata work budget');
  }

  plan(token, depth = 0) {
    if (token === 0) return rootSlot;
    if (this.plans.has(token)) return this.plans.get(token);
    if (depth >= 64) throw new CilError('Constrained Object reference hierarchy exceeds 64 levels or is cyclic');
    this.charge();
    const type = this.objects.types.get(token), parent = this.parents.get(token);
    if (!type || parent === null || parent === undefined || type.flags & 0x20 || this.objects.genericOwners.has(token)) {
      this.plans.set(token, null);
      return null;
    }
    const base = this.plan(parent, depth + 1);
    if (!base) { this.plans.set(token, null); return null; }
    if (base.depth >= 64) throw new CilError('Constrained Object reference hierarchy exceeds 64 levels');
    this.charge(this.objects.implementations.get(token)?.length ?? 0);
    this.objects.rejectExplicit(token);
    let declared = null;
    for (const method of type.methods) {
      this.charge();
      if (!this.objects.virtualMethod(method)) continue;
      if (declared) throw new CilError('Ambiguous Object.ToString virtual declaration');
      declared = method;
    }
    // Only the first visible virtual slot can originate in Object. Later newslots
    // and their overrides remain separate; the existing slot resolver preserves that distinction.
    const first = base.first ?? declared?.token ?? null;
    const anchor = base.anchor ?? (base.first === null && declared && !(declared.flags & 0x100) ? declared.token : null);
    // Resolve metadata slots without treating an abstract declared constraint as an actual receiver.
    const slots = anchor ? this.dispatch.table(token) : null;
    for (const row of slots ? this.objects.implementations.get(token) ?? [] : []) {
      this.charge();
      const declaration = this.dispatch.definition(decodeCoded('MethodDefOrRef', row[2]));
      if (slots.declarations.get(declaration.token) === slots.declarations.get(anchor)) {
        throw new CilError('Explicit Object.ToString slot implementation is not implemented');
      }
    }
    const target = slots ? this.dispatch.resolveSlot(slots, slots.declarations.get(anchor)) : null;
    if (anchor && !target) throw new CilError('Constrained Object slot has no implementation');
    const result = Object.freeze({first, anchor, target, depth: base.depth + 1});
    this.plans.set(token, result);
    return result;
  }

  select(token, descriptor) {
    return this.objects.types.has(token) && this.objects.declaration(descriptor) ? this.plan(token) : null;
  }

  targets(token) {
    if (this.reachable.has(token)) return this.reachable.get(token);
    const pending = [token], seen = new Set(), targets = new Set();
    while (pending.length) {
      this.charge();
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      const plan = this.plan(current);
      if (!plan) continue;
      const type = this.objects.types.get(current);
      if (!(type.flags & 0x80) && plan.target) targets.add(plan.target);
      for (const child of this.children.get(current) ?? []) pending.push(child);
    }
    const result = Object.freeze([...targets]);
    this.reachable.set(token, result);
    return result;
  }
}
