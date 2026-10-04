import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';
import {slotCache} from './object-slot-profile.js';
import {genericTypeParts} from './generic-signatures.js';

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
    this.parameters = null;
    this.constraints = null;
    this.bounds = new Map();
    this.remaining = 262_144;
    this.charge(inspector.types.length);
    const names = new Map(inspector.types.map(type => [type.name, type.token]));
    for (const type of inspector.types) {
      let parent = null;
      if (type.baseToken >>> 24 === 2) parent = type.baseToken;
      else if ([1, 27].includes(type.baseToken >>> 24)) {
        const name = genericTypeParts(inspector.metadata.typeName(type.baseToken)).definition;
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

  plan(token, depth = 0, name = 'ToString') {
    if (token === 0) return rootSlot;
    const plans = slotCache(this.plans, name);
    if (plans.has(token)) return plans.get(token);
    if (depth >= 64) throw new CilError('Constrained Object reference hierarchy exceeds 64 levels or is cyclic');
    this.charge();
    const type = this.objects.types.get(token), parent = this.parents.get(token);
    if (!type || parent === null || parent === undefined || type.flags & 0x20) {
      plans.set(token, null);
      return null;
    }
    const base = this.plan(parent, depth + 1, name);
    if (!base) { plans.set(token, null); return null; }
    if (base.depth >= 64) throw new CilError('Constrained Object reference hierarchy exceeds 64 levels');
    this.charge(this.objects.implementations.get(token)?.length ?? 0);
    this.objects.rejectExplicit(token, name);
    let declared = null;
    for (const method of type.methods) {
      this.charge();
      if (!this.objects.virtualMethod(method, name)) continue;
      if (declared) throw new CilError(`Ambiguous Object.${name} virtual declaration`);
      declared = method;
    }
    // Only the first visible virtual slot can originate in Object. Later newslots
    // and their overrides remain separate; the existing slot resolver preserves that distinction.
    const first = base.first ?? declared?.token ?? null;
    const anchor = base.anchor ?? (base.first === null && declared && !(declared.flags & 0x100) ? declared.token : null);
    // Resolve metadata slots without treating an abstract declared constraint as an actual receiver.
    const slots = anchor ? this.dispatch.table(token) : null;
    const owners = slots?.declarationsByToken.get(anchor);
    if (owners && owners.size !== 1) throw new CilError(`Ambiguous Object.${name} declaring instance`);
    const index = owners?.values().next().value;
    for (const row of slots ? this.objects.implementations.get(token) ?? [] : []) {
      this.charge();
      const declaration = this.dispatch.definition(decodeCoded('MethodDefOrRef', row[2]));
      const declarations = slots.declarationsByToken.get(declaration.token);
      if (declarations && [...declarations.values()].includes(index)) {
        throw new CilError(`Explicit Object.${name} slot implementation is not implemented`);
      }
    }
    const target = owners ? slots.targets[index] : null;
    if (anchor && !target) throw new CilError('Constrained Object slot has no implementation');
    const result = Object.freeze({first, anchor, target, depth: base.depth + 1});
    plans.set(token, result);
    return result;
  }

  select(token, descriptor) {
    return this.objects.types.has(token) && this.objects.declaration(descriptor) ? this.plan(token, 0, descriptor.name) : null;
  }

  indexParameters() {
    const parameters = this.inspector.metadata.rows[42] ?? [];
    const constraints = this.inspector.metadata.rows[44] ?? [];
    this.charge(parameters.length + constraints.length);
    this.parameters = new Map();
    this.constraints = new Map();
    for (let index = 0; index < parameters.length; index++) {
      const row = parameters[index], owner = decodeCoded('TypeOrMethodDef', row[2]);
      let entries = this.parameters.get(owner);
      if (!entries) this.parameters.set(owner, entries = new Map());
      if (entries.has(row[0])) throw new CilError('Duplicate generic parameter ordinal');
      entries.set(row[0], {row: index + 1, flags: row[1], bound: undefined});
    }
    for (const row of constraints) {
      if (!this.constraints.has(row[0])) this.constraints.set(row[0], []);
      this.constraints.get(row[0]).push(decodeCoded('TypeDefOrRef', row[1]));
    }
  }

  /** Resolve one !n/!!n to a concrete internal base bound, or null outside this leaf.
   * Existing generic validation still owns ordinal, arity and closed-argument constraints.
   */
  genericBound(method, token) {
    let cached = this.bounds.get(method.token);
    if (!cached) this.bounds.set(method.token, cached = new Map());
    if (cached.has(token)) return cached.get(token);
    this.charge();
    const variable = token >>> 24 === 27 && /^(!!?)(\d+)$/.exec(this.inspector.metadata.typeName(token));
    const definition = this.inspector.methods.get(method.token);
    if (!variable || !definition) return null;
    if (!this.parameters) this.indexParameters();
    const owner = variable[1] === '!!' ? definition.token : definition.ownerToken;
    const parameter = this.parameters.get(owner)?.get(Number(variable[2]));
    if (parameter && parameter.bound === undefined) {
      parameter.bound = parameter.flags & 8 ? null : this.parameterBase(parameter.row);
    }
    const bound = parameter?.bound ?? null;
    cached.set(token, bound);
    return bound;
  }

  parameterBase(row) {
    let bound = null;
    for (const token of this.constraints.get(row) ?? []) {
      this.charge();
      const type = this.objects.types.get(token);
      // Interface bounds remain enforced by generic admission; a class bound is mandatory.
      if (!type || this.objects.genericOwners.has(token)) return null;
      if (type.flags & 0x20) continue;
      if (bound !== null || !this.plan(token)) return null;
      bound = token;
    }
    return bound;
  }

  targets(token, descriptor = null) {
    const name = descriptor?.name ?? 'ToString', reachable = slotCache(this.reachable, name);
    if (reachable.has(token)) return reachable.get(token);
    const pending = [token], seen = new Set(), targets = new Set();
    while (pending.length) {
      this.charge();
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      const plan = this.plan(current, 0, name);
      if (!plan) continue;
      const type = this.objects.types.get(current);
      if (type && !(type.flags & 0x80) && plan.target) targets.add(plan.target);
      for (const child of this.children.get(current) ?? []) pending.push(child);
    }
    const result = Object.freeze([...targets]);
    reachable.set(token, result);
    return result;
  }
}
