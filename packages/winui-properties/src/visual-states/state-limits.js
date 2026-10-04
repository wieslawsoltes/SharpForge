import {ResourceFault} from '../resources/errors.js';

/** Materialize a declarative collection only up to its public profile budget. */
export function stateList(values, limit, description) {
  if (!values?.[Symbol.iterator]) throw new ResourceFault('SFSTATE005', description + ' must be iterable.');
  const result = [];
  for (const value of values) {
    if (result.length >= limit) throw new ResourceFault('SFSTATE005', description + ' budget exceeded.');
    result.push(value);
  }
  return result;
}

/** Validate the whole template definition before installing any trigger or definition listener. */
export function validateStateGroups(groups) {
  const names = new Set(), groupNames = new Set();
  let count = 0;
  for (const group of groups) {
    if (typeof group?.subscribeDefinition !== 'function' || !Array.isArray(group.states)) {
      throw new ResourceFault('SFSTATE005', 'A visual state group definition is required.');
    }
    if (group.name && groupNames.has(group.name)) throw new ResourceFault('SFSTATE001', 'Visual state group names must be unique.');
    if (group.name) groupNames.add(group.name);
    if (group.transitions.length > 4096) throw new ResourceFault('SFSTATE005', 'Visual transition budget exceeded.');
    for (const state of group.states) {
      if (++count > 4096) throw new ResourceFault('SFSTATE005', 'Visual state budget exceeded.');
      if (typeof state?.subscribeDefinition !== 'function' || typeof state.name !== 'string' || state.name.length > 1024) {
        throw new ResourceFault('SFSTATE005', 'A visual state definition is required.');
      }
      if (names.has(state.name)) throw new ResourceFault('SFSTATE001', 'Visual state names must be unique in a template root.');
      names.add(state.name);
      if (state.setters.length > 16384 || state.triggers.length > 1024) {
        throw new ResourceFault('SFSTATE005', 'Visual state setter or trigger budget exceeded.');
      }
    }
  }
}
