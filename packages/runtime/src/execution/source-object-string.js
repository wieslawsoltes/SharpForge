import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';

const profiles = new WeakMap();
const objectSlot = Object.freeze({slot: null, target: null});

function profileFor(vm) {
  const epoch = executionCodeState(vm);
  let profile = profiles.get(epoch);
  if (profile) return profile;
  const methods = new Map();
  for (const method of vm.image.methods) {
    if (method.name !== 'ToString' || method.isStatic || method.parameters.length ||
        !['string', 'System.String'].includes(method.returnType)) continue;
    for (const key of ['isVirtual', 'isNewSlot', 'isFinal']) {
      if (method[key] !== undefined && typeof method[key] !== 'boolean') {
        throw new ManagedFault('InvalidProgramException', 'Invalid source virtual method metadata');
      }
    }
    if (!method.isVirtual) continue;
    if (methods.has(method.owner)) throw new ManagedFault('InvalidProgramException', 'Ambiguous Object.ToString virtual declaration');
    methods.set(method.owner, method);
  }
  profile = {methods, plans: new Map()};
  profiles.set(epoch, profile);
  return profile;
}

function plan(profile, table, depth = 0) {
  if (!table || table.name === 'System.Object') return objectSlot;
  if (profile.plans.has(table)) return profile.plans.get(table);
  if (depth >= 64) throw new ManagedFault('NotSupportedException', 'Object.ToString hierarchy exceeds 64 levels');
  const base = plan(profile, table.base, depth + 1);
  const method = profile.methods.get(table.name);
  // A new virtual slot hides Object's slot; overriding that new slot cannot replace Object.ToString.
  const result = !method ? base : method.isNewSlot ? {slot: method.id, target: base.target}
    : {slot: base.slot, target: base.slot === null ? method.id : base.target};
  profile.plans.set(table, result);
  return result;
}

/** The source image supplies virtual slot flags; a same-named ordinary method is never a callback. */
export function sourceObjectStringTarget(vm, table) {
  return plan(profileFor(vm), table).target;
}
