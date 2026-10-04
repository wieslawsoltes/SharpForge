import {ResourceFault} from '../resources/errors.js';

/** Stop an untrusted iterable before it can exceed the owning collection's allocation budget. */
export function boundedItems(source, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('A finite nonnegative item budget is required.');
  if (!source?.[Symbol.iterator]) throw new ResourceFault('SFITEM008', 'Items must be an iterable collection.');
  const values = [];
  for (const value of source) {
    if (values.length >= limit) throw new ResourceFault('SFITEM002', 'Items collection limit exceeded.');
    values.push(value);
  }
  return values;
}

export function cleanupItems(actions, message, cause = null) {
  const failures = cause ? [cause] : [];
  for (const action of actions) {
    try { action(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, message, cause ? {cause} : undefined);
}
