import {managedExceptionTypes} from '@sharpforge/bytecode';

/** The compiler and both runtimes share the same closed exception hierarchy. */
export function withManagedExceptionTypes(types) {
  const result = new Map(types);
  for (const definition of managedExceptionTypes) {
    if (!result.has(definition.name)) result.set(definition.name, {...definition, kind: 'exception', properties: {}, events: {}});
  }
  return result;
}
