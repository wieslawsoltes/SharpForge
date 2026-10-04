import {
  managedExceptionTypes
} from './exception-types.js';

const definitions = [];

function add(owner, name, parameters, returnType, isStatic = false, implementation = 'exception') {
  definitions.push(Object.freeze({
    owner,
    name,
    parameters: Object.freeze(parameters),
    returnType,
    isStatic,
    implementation
  }));
}
for (const {
    name: owner
  }
  of managedExceptionTypes) {
  for (const parameters of [
      [],
      ['string'],
      ['string', 'System.Exception']
    ]) {
    add(owner, '.ctor', parameters, 'void', false, 'exceptionCtor');
  }
  for (const [name, type] of [
      ['Message', 'string'],
      ['InnerException', 'System.Exception'],
      ['StackTrace', 'string'],
      ['HResult', 'int'],
      ['Data', 'System.Collections.IDictionary']
    ]) add(owner, 'get_' + name, [], type);
  add(owner, 'set_HResult', ['int'], 'void');
  add(owner, 'GetBaseException', [], 'System.Exception');
  add(owner, 'ToString', [], 'string');
}
const dispatch = 'System.Runtime.ExceptionServices.ExceptionDispatchInfo';
add(dispatch, 'Capture', ['System.Exception'], dispatch, true);
add(dispatch, 'get_SourceException', [], 'System.Exception');
add(dispatch, 'Throw', [], 'void');
add(dispatch, 'Throw', ['System.Exception'], 'void', true);
const aggregate = 'System.AggregateException';
const collection = 'System.Collections.ObjectModel.ReadOnlyCollection`1<System.Exception>';
for (const parameters of [
    ['System.Exception[]'],
    ['string', 'System.Exception[]'],
    ['System.Collections.Generic.IEnumerable`1<System.Exception>'],
    ['string', 'System.Collections.Generic.IEnumerable`1<System.Exception>']
  ]) add(aggregate, '.ctor', parameters, 'void', false, 'exceptionCtor');
add(aggregate, 'Flatten', [], aggregate);
add(aggregate, 'get_InnerExceptions', [], collection);
for (const owner of [collection, 'System.Collections.Generic.IReadOnlyList`1<System.Exception>']) {
  add(owner, 'get_Item', ['int'], 'System.Exception');
  add(owner, 'get_Count', [], 'int');
}
for (const owner of ['System.Collections.IDictionary', 'System.Collections.Hashtable']) {
  add(owner, 'get_Item', ['object'], 'object');
  add(owner, 'set_Item', ['object', 'object'], 'void');
  add(owner, 'Add', ['object', 'object'], 'void');
  add(owner, 'Contains', ['object'], 'bool');
  add(owner, 'Remove', ['object'], 'void');
  add(owner, 'Clear', [], 'void');
  add(owner, 'get_Count', [], 'int');
}

/** Finite exact signatures shared by CIL acceptance and the exception runtime. */
export const exceptionIntrinsicDefinitions = Object.freeze(definitions);
