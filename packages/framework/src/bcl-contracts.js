import {createBclRegistry, registerBclModules} from '@sharpforge/bcl-core';
import {closedCollectionsModule} from '@sharpforge/bcl-collections';

const collections = createBclRegistry([closedCollectionsModule]);

/** Explicit closed BCL surface; registrations append, never renumber older ABI members. */
export function registerBcl(registry) {
  const {define, member, prop} = registry;
  registerBclModules(registry, {group: 'bcl-prefix'});
  collections.register(registry, {group: 'bcl-collections'});
  registerBclModules(registry, {group: 'bcl-suffix'});
  define('System.Math', {kind: 'bcl', family: 'math'});
  for (const method of ['Sin', 'Cos', 'Tan', 'Asin', 'Acos', 'Atan', 'Log', 'Log10', 'Exp', 'Truncate']) {
    member('System.Math', method, ['double'], 'double', {isStatic: true});
  }
  member('System.Math', 'Atan2', ['double', 'double'], 'double', {isStatic: true});
  for (const type of ['int', 'double']) member('System.Math', 'Clamp', [type, type, type], type, {isStatic: true});
  prop('System.Math', 'PI', 'double', Math.PI, true, true);
  prop('System.Math', 'E', 'double', Math.E, true, true);
}

/** New collection contracts occupy A08 without changing released collection IDs. */
export function registerBclCollectionExtensions(registry) {
  collections.register(registry, {group: 'extensions'});
}
