import {
  sourceExceptionDefinitions
} from './source-exception-profile.js';
import {
  syncIntrinsicDefinitions
} from './sync-intrinsic-profile.js';
import {varargsIntrinsicDefinitions} from './varargs-profile.js';

/** Control adapters append after existing builtin IDs; descriptors retain exact CLR signatures. */
export function appendControlBuiltins(entries, firstId) {
  let id = firstId;
  for (const profile of sourceExceptionDefinitions) {
    const constructing = profile.name === '.ctor';
    const parameters = constructing || profile.isStatic ? profile.parameters : [profile.owner, ...profile.parameters];
    entries[id] = Object.freeze({
      id,
      name: '$exception:' + id,
      min: parameters.length,
      max: parameters.length,
      result: constructing ? profile.owner : profile.returnType,
      params: Object.freeze(parameters),
      exceptionRuntime: profile
    });
    id++;
  }
  for (const profile of syncIntrinsicDefinitions) {
    entries[id] = Object.freeze({
      id,
      name: '$synchronization:' + id,
      min: profile.parameters.length,
      max: profile.parameters.length,
      result: profile.returnType,
      params: profile.parameters,
      synchronization: profile
    });
    id++;
  }
  for (const profile of varargsIntrinsicDefinitions) {
    const constructing = profile.name === '.ctor';
    const parameters = constructing || profile.isStatic ? profile.parameters : [profile.owner + '&', ...profile.parameters];
    entries[id] = Object.freeze({
      id, name: '$varargs:' + id, min: parameters.length, max: parameters.length,
      result: constructing ? profile.owner : profile.returnType,
      params: Object.freeze(parameters), varargs: profile
    });
    id++;
  }
  return id;
}
