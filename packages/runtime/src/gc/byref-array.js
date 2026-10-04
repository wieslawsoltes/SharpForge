import {ManagedFault} from './fault.js';
import {frameworkType} from '@sharpforge/framework';
import {checkArrayStore} from '../execution/casting.js';

/** Source owner/index cells require the same exact element identity and bounds as a writable CLI ldelema. */
export function validateElementReference(platform, args) {
  const element = platform.native(args[2]);
  if (typeof element !== 'string' || !element || element.length > 1024 || /[!&*]/.test(element)) {
    throw new ManagedFault('ArgumentException', 'An array reference requires a concrete element type');
  }
  const record = platform.vm.indexed(args[0], platform.native(args[1]));
  if (record.methodTable.elementType !== platform.heap.methodTables.get(element)) {
    throw new ManagedFault('ArrayTypeMismatchException', 'An array element reference requires the actual element type');
  }
  if (record.space === 'frozen') throw new ManagedFault('InvalidOperationException', 'Frozen arrays expose no writable element references');
  return null;
}

/** Recognize only the declared compiler cell ABI; arbitrary three-field objects are not out parameters. */
export function writeArrayReferenceCell(platform, reference, record, value) {
  const layout = frameworkType('SharpForge.Runtime.GCArray').sourceReferenceCell;
  const fields = record.methodTable.fields;
  if (record.kind !== 'object' || record.data.length !== layout.fields.length || fields.length !== layout.fields.length ||
      !fields.every((field, index) => field.name === layout.fields[index]) ||
      fields[layout.owner].type.elementType !== fields[layout.value].type ||
      fields[layout.index].type !== platform.heap.methodTables.get('int')) return false;
  const owner = record.data[layout.owner];
  if (owner === null) {
    platform.heap.writeField(reference, layout.value, value);
    return true;
  }
  const index = record.data[layout.index];
  validateElementReference(platform, [owner, index, fields[layout.value].type.name]);
  checkArrayStore(platform.heap, platform.heap.get(owner), value);
  platform.heap.writeElement(owner, index, value);
  return true;
}
