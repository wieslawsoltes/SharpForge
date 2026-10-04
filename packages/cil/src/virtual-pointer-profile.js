import {CilError} from './binary.js';
import {callSignatureKey} from './call-profile.js';
import {CilDispatchTable} from './dispatch-profile.js';
import {InstanceCalliTargets} from './instance-calli-targets.js';

/** Metadata-only bounded reachability for nongeneric class ldvirtftn. Recreate per code epoch. */
export class VirtualPointerProfile {
  constructor(inspector, dispatch = new CilDispatchTable(inspector)) {
    this.inspector = inspector;
    this.dispatch = dispatch;
    this.instances = new InstanceCalliTargets(inspector);
    this.children = new Map();
    this.classes = new Map();
    this.classDepths = new Map();
    this.tableSizes = new Map();
    this.tableDepths = new Map();
    this.targets = new Map();
    this.targetSets = new Map();
    this.work = 0;
    this.indexed = false;
  }

  index() {
    if (this.indexed) return;
    this.charge(this.inspector.metadata.rows[42]?.length ?? 0);
    this.charge(this.inspector.metadata.rows[25]?.length ?? 0);
    for (const type of this.inspector.types) {
      this.charge(1 + type.methods.length + type.interfaces.length);
      const parent = this.definition(type.baseToken);
      if (!parent) continue;
      let children = this.children.get(parent.token);
      if (!children) this.children.set(parent.token, children = []);
      children.push(type);
    }
    this.indexed = true;
  }

  charge(amount) {
    this.work += amount;
    if (this.work > 262144) throw new CilError('ldvirtftn metadata work budget exceeded');
  }

  definition(token) {
    if (!token || token >>> 24 === 27) return null;
    return this.dispatch.types.get(token) ?? this.dispatch.names.get(this.inspector.metadata.typeName(token));
  }

  acceptsClass(token, depth = 0) {
    if (this.classes.has(token)) return this.classes.get(token);
    this.charge(1);
    if (depth > 64) throw new CilError('ldvirtftn class hierarchy depth exceeded');
    const type = this.dispatch.types.get(token);
    if (!type || type.flags & 0x20 || this.instances.genericOwners.has(token)) return false;
    const parent = this.definition(type.baseToken);
    const accepted = parent ? this.acceptsClass(parent.token, depth + 1)
      : !!type.baseToken && this.inspector.metadata.typeName(type.baseToken) === 'System.Object';
    const ancestry = parent ? (this.classDepths.get(parent.token) ?? 0) + 1 : 1;
    if (accepted && ancestry > 64) throw new CilError('ldvirtftn class hierarchy depth exceeded');
    this.classDepths.set(token, ancestry);
    this.classes.set(token, accepted);
    return accepted;
  }

  // Bound inherited table copies and MethodImpl/slot matching before entering the shared resolver.
  prepareTable(token, depth = 0) {
    if (this.tableSizes.has(token)) return this.tableSizes.get(token);
    if (depth > 64) throw new CilError('ldvirtftn dispatch hierarchy depth exceeded');
    const type = this.dispatch.types.get(token);
    let size = 1 + type.methods.length, ancestry = 1;
    for (const dependency of [type.baseToken, ...type.interfaces]) {
      const definition = this.definition(dependency);
      if (dependency >>> 24 === 27 || definition && this.instances.genericOwners.has(definition.token)) {
        throw new CilError('ldvirtftn generic dispatch hierarchies are not supported');
      }
      if (definition) {
        size += this.prepareTable(definition.token, depth + 1);
        ancestry = Math.max(ancestry, this.tableDepths.get(definition.token) + 1);
      }
      this.charge(1);
    }
    if (ancestry > 64) throw new CilError('ldvirtftn dispatch hierarchy depth exceeded');
    const implementations = this.dispatch.implementations.get(token)?.length ?? 0;
    this.charge(size * size + implementations * (size + 1));
    this.tableSizes.set(token, size);
    this.tableDepths.set(token, ancestry);
    return size;
  }

  contains(declaration, target) {
    this.reachable(declaration);
    return this.targetSets.get(declaration).has(target);
  }

  reachable(token) {
    if (this.targets.has(token)) return this.targets.get(token);
    this.index();
    const declaration = this.inspector.methods.get(token);
    if (!this.instances.acceptsDeclaration(token) || !this.acceptsClass(declaration.ownerToken)) {
      throw new CilError('ldvirtftn requires a nongeneric internal reference-class virtual declaration');
    }
    const queue = [this.dispatch.types.get(declaration.ownerToken)], result = new Set();
    const signature = callSignatureKey(this.inspector.signature(token));
    for (let index = 0; index < queue.length; index++) {
      const type = queue[index];
      this.charge(1);
      if (!this.acceptsClass(type.token)) continue;
      for (const child of this.children.get(type.token) ?? []) queue.push(child);
      if (type.flags & 0x80) continue;
      this.prepareTable(type.token);
      const target = this.dispatch.resolve(type.token, token);
      if (!this.instances.accepts(target) || callSignatureKey(this.inspector.signature(target)) !== signature) {
        throw new CilError('ldvirtftn selected body is not an executable exact-signature instance target');
      }
      result.add(target);
    }
    if (!result.size) throw new CilError('ldvirtftn declaration has no executable class implementation');
    const targets = Object.freeze([...result]);
    this.targets.set(token, targets);
    this.targetSets.set(token, result);
    return targets;
  }
}
