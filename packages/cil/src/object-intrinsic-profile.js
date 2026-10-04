import {managedExceptionTypes} from '@sharpforge/bytecode';

/** Exact Object signatures, including inherited nonvirtual MemberRef owners emitted by Roslyn. */
export function registerObjectIntrinsics(add) {
  add('System.Object', '.ctor', [], 'void', false, 'objectCtor');
  add('System.Object', 'ToString', [], 'string', false, 'objectToString');
  add('System.Object', 'Equals', ['object'], 'bool', false, 'objectEquals');
  add('System.Object', 'GetHashCode', [], 'int', false, 'objectHashCode');
  add('System.Object', 'GetType', [], 'System.Type', false, 'objectGetType');
  add('System.Object', 'ReferenceEquals', ['object', 'object'], 'bool', true, 'objectReferenceEquals');
  for (const {name} of managedExceptionTypes) {
    add(name, 'GetType', [], 'System.Type', false, 'objectGetType');
  }
}
