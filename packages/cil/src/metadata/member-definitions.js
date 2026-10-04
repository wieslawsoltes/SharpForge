import {CilError} from '../binary.js';

const maximumMembers = 100000;
export const memberAccessFlags = new Map([
  ['private', 1], ['privateProtected', 2], ['internal', 3], ['protected', 4],
  ['protectedInternal', 5], ['public', 6],
]);
export const memberAccessNames = new Map([...memberAccessFlags].map(([name, flags]) => [flags, name]));

function requireMember(condition, message) {
  if (!condition) throw new CilError('Invalid member definitions: ' + message);
}

function completeRecords(records, count, keyOf, validate, label) {
  requireMember(Array.isArray(records) && records.length === count && count <= maximumMembers, label + ' count');
  const seen = new Set();
  return records.map(record => {
    requireMember(record && typeof record === 'object' && !Array.isArray(record)
      && memberAccessFlags.has(record.access), label + ' accessibility');
    validate(record);
    const key = keyOf(record);
    requireMember(!seen.has(key), 'duplicate ' + label + ' identity');
    seen.add(key);
    return {...record};
  });
}

const indexIn = (index, values) => Number.isSafeInteger(index) && index >= 0 && index < values.length;

/** Validate the complete source member projection without changing the caller's records or image. */
export function memberDefinitionProfile(image, input) {
  if (input === undefined) return undefined;
  requireMember(input && typeof input === 'object' && !Array.isArray(input) && input.version === 1, 'version');
  const methods = completeRecords(input.methods, image.methods.length, record => record.id, record => {
    requireMember(indexIn(record.id, image.methods), 'method identity');
  }, 'method').map(({id, access}) => ({id, access}));
  const fieldCount = image.types.reduce((count, type) => count + type.fields.length, 0);
  const fields = completeRecords(input.fields, fieldCount, record => record.type + ':' + record.index, record => {
    requireMember(indexIn(record.type, image.types) && indexIn(record.index, image.types[record.type].fields)
      && typeof record.isReadOnly === 'boolean', 'field identity or readonly flag');
  }, 'field').map(({type, index, access, isReadOnly}) => ({type, index, access, isReadOnly}));
  const statics = completeRecords(input.statics, image.statics.length, record => record.index, record => {
    requireMember(indexIn(record.index, image.statics) && typeof record.isReadOnly === 'boolean', 'static identity or readonly flag');
  }, 'static').map(({index, access, isReadOnly}) => ({index, access, isReadOnly}));
  return {version: 1, methods, fields, statics};
}
