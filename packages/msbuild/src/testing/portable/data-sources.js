import {hasUnresolved} from './attribute-values.js';
import {evaluateManagedTestData} from './runtime-data.js';

/** Resolve static constant providers directly; computed providers use an explicit managed-runtime resolver. */
export async function resolveTestData(symbols, method, descriptor, options = {}) {
  const {resolveData, signal, maxRows = 10_000} = options;
  signal?.throwIfAborted();
  let type = method.declaringType;
  if (descriptor.type) type = symbols.types.find(value => value.fqn === descriptor.type || value.name === descriptor.type);
  if (!type) return {rows: [], reason: 'Data-provider type was not found: ' + descriptor.type};
  let rows = descriptor.kind === 'class' ? !type.hasFields && !type.constructors.length &&
    type.methods.find(value => value.name === 'GetEnumerator')?.constantRows :
    type.dataMembers?.get(descriptor.member);
  if (!rows && resolveData) rows = await resolveData({method, ...descriptor, signal});
  if (!rows && options.evaluateData !== false) {
    try { rows = await evaluateManagedTestData(symbols, type, descriptor, options); }
    catch (error) {
      signal?.throwIfAborted();
      return {rows: [], reason: 'Data provider is not runnable: ' + error.message};
    }
  }
  if (!rows) return {rows: [], reason: 'Data provider requires managed evaluation: ' + (descriptor.member ?? descriptor.type)};
  if (!Array.isArray(rows) || rows.length > maxRows) throw new Error('Test data-row limit exceeded');
  if (hasUnresolved(rows)) return {rows: [], reason: 'Test data provider contains unresolved values'};
  return {rows: rows.map(row => Array.isArray(row) ? row : [row]), reason: null};
}
