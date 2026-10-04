import {grantsInternalsAccess} from '../assembly-access.js';
import {requireProjectReference} from './project-reference-errors.js';

const friendAttribute = 'System.Runtime.CompilerServices.InternalsVisibleToAttribute';

/** Index actual friend-assembly attributes once; member checks never infer access from source names. */
export function projectGraphAccess() {
  const friends = new Map();
  function internalAccess(requester, target) {
    if (requester.key === target.key) return true;
    let readers = friends.get(target.key);
    if (!readers) {
      readers = new Map();
      friends.set(target.key, readers);
    }
    if (!readers.has(requester.key)) {
      const declarations = target.assemblyAttributes.filter(attribute => attribute.type === friendAttribute)
        .map(attribute => attribute.value);
      readers.set(requester.key, grantsInternalsAccess(declarations, requester.identity));
    }
    return readers.get(requester.key);
  }
  return {
    type(requester, target, definition) {
      const access = definition.flags & 7;
      requireProjectReference(access === 1 || access === 0 && internalAccess(requester, target),
        'PRJ0005', 'inaccessible project type: ' + definition.name);
    },
    member(requester, target, definition) {
      const access = definition.flags & 7;
      // Cross-project inheritance/virtual dispatch is outside this closed class profile.
      requireProjectReference(access === 6 || (access === 3 || access === 5) && internalAccess(requester, target),
        'PRJ0005', 'inaccessible project member: ' + definition.name);
    },
  };
}
