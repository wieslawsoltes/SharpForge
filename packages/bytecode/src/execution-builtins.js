import {numericIntrinsicDefinitions} from './numeric-intrinsic-profile.js';
import {syncIntrinsicDefinitions} from './sync-intrinsic-profile.js';
import {arrayIntrinsicDefinitions} from './array-intrinsic-profile.js';

/** Append execution profiles after released core, framework and runtime identities. */
export function appendExecutionBuiltins(entries) {
  for (const [kind, definitions] of [
    ['numeric', numericIntrinsicDefinitions], ['synchronization', syncIntrinsicDefinitions],
    ['arrayRuntime', arrayIntrinsicDefinitions]
  ]) {
    for (const descriptor of definitions) {
      const constructor = descriptor.name === '.ctor';
      const receiver = !descriptor.isStatic && !constructor ? [descriptor.owner] : [];
      const params = Object.freeze([...receiver, ...descriptor.parameters]);
      entries.push(Object.freeze({
        id: entries.length,
        name: '$' + kind + ':' + descriptor.owner + '::' + descriptor.name
          + '(' + descriptor.parameters.join(',') + '):' + descriptor.returnType,
        min: params.length, max: params.length,
        result: constructor ? descriptor.owner : descriptor.returnType,
        params, [kind]: descriptor
      }));
    }
  }
}
