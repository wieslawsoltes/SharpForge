const owner = 'System.Boolean';
const unhandled = Object.freeze({handled: false});

function contracts({define}) {
  define(owner, {
    kind: 'value',
    family: 'boolean',
    base: 'System.ValueType',
    isSealed: true,
    fields: {
      TrueString: {
        type: 'string', isStatic: true, readOnly: true, value: 'True', addressable: false,
        assemblies: ['System.Runtime', 'System.Private.CoreLib']
      },
      FalseString: {
        type: 'string', isStatic: true, readOnly: true, value: 'False', addressable: false,
        assemblies: ['System.Runtime', 'System.Private.CoreLib']
      }
    }
  });
}

/** Boolean's readonly string fields use generic field storage and consume no method contracts. */
export const booleanModule = Object.freeze({
  name: 'boolean',
  families: Object.freeze(['boolean']),
  contracts,
  invoke: () => unhandled
});
