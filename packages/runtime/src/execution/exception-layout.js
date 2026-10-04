import {
  exceptionBaseType
} from './exception-types.js';
/** Named inherited layout. Slots are stable for debugger and snapshot consumers. */
export const exceptionFields = Object.freeze([{
    name: 'Message',
    type: 'string'
  }, {
    name: 'InnerException',
    type: 'System.Exception'
  },
  {
    name: 'HResult',
    type: 'int'
  }, {
    name: 'Data',
    type: 'System.Collections.IDictionary'
  },
  {
    name: '_stackTrace',
    type: 'object'
  }
].map(Object.freeze));
export const exceptionSlots = Object.freeze({
  Message: 0,
  InnerException: 1,
  HResult: 2,
  Data: 3,
  _stackTrace: 4
});


/** MethodTable contribution kept pure to avoid the heap/exception-object import cycle. */
export function exceptionTypeDefinition(name) {
  const base = exceptionBaseType(name);
  if (!base) return null;
  const fields = name === 'System.Exception' ? exceptionFields : name === 'System.AggregateException' ? [{
    name: '_innerExceptions',
    type: 'object'
  }] : [];
  return {
    base,
    flags: {
      exception: true
    },
    fields
  };
}
