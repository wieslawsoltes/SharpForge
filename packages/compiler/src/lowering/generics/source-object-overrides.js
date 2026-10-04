import {sourceObjectOverride} from '../../codegen/semantic/object-slots.js';

/** Boxing exposes Object slots even when no source expression directly calls the override. */
export function declareConstructedObjectOverrides(generator, instance) {
  for (const name of ['ToString', 'Equals', 'GetHashCode']) {
    for (const member of instance.type.getMembers(name)) {
      if (sourceObjectOverride(member)) generator.methodOf(member, member.locations?.[0]);
    }
  }
}
