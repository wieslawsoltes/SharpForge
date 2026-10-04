import {managedFixture} from '../managed-fixtures.js';

export const objectStringInputs = [
  ['empty-builder', 'System.Text.StringBuilder', ''],
  ['builder', 'System.Text.StringBuilder', 'value'],
  ['mutated-builder', 'System.Text.StringBuilder', 'value!'],
  ['uri', 'System.Uri', 'https://example.com/path?q=1'],
  ['null', null, null]
];

/** The external Object member and opcode are authored independently of C# lowering. */
export function objectStringAssembly(input, kind = 'callvirt') {
  const [, owner, value] = input;
  return managedFixture({name: 'ObjectString', methods: [{name: 'Main', result: 'string', body(w, context) {
    if (owner === null) w.op('ldnull');
    else w.op('ldstr', 0x70000000 + context.md.userString(value))
      .op('newobj', context.member(owner, '.ctor', 'void', ['string'], false));
    w.op(kind, context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
  }}]});
}

export function hiddenStringAssembly() {
  return managedFixture({name: 'HiddenString', methods: [
    {name: 'Main', result: 'string', body(w, context) {
      w.op('newobj', context.methods['.ctor'])
        .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }},
    {name: '.ctor', static: false, flags: 0x1886, body(w, context) {
      w.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret');
    }},
    {name: 'ToString', static: false, result: 'string', body(w, context) {
      w.op('ldstr', 0x70000000 + context.md.userString('hidden')).op('ret');
    }}
  ]});
}

export function primitiveStringAssembly(kind) {
  return managedFixture({name: 'PrimitiveObjectString', methods: [{name: 'Main', result: 'string', body(w, context) {
    w.op('ldc.i4', 42).op('box', context.resolve('System.Int32'))
      .op(kind, context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
  }}]});
}
