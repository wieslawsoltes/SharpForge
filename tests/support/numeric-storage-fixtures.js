import {controlFixture} from './control-fixture.js';
import {numericAliases} from '@sharpforge/bytecode';

const metadataNames = Object.freeze({bool: 'System.Boolean',
  ...Object.fromEntries(Object.entries(numericAliases).map(([name, alias]) => [alias, name]))});

export const smallStorageTypes = Object.freeze([
  {type: 'sbyte', suffix: 'i1', minimum: -128, maximum: 127},
  {type: 'byte', suffix: 'u1', minimum: 0, maximum: 255},
  {type: 'short', suffix: 'i2', minimum: -32768, maximum: 32767},
  {type: 'ushort', suffix: 'u2', minimum: 0, maximum: 65535},
  {type: 'char', suffix: 'u2', minimum: 0, maximum: 65535},
  {type: 'bool', suffix: 'u1', minimum: 0, maximum: 255},
]);
export const smallStorageLocations = Object.freeze(['local', 'arg', 'field', 'static', 'array', 'byref']);

/** Raw i4 stores deliberately bypass source casts so the destination owns narrowing. */
export function smallStorageFixture(type, suffix, location, input) {
  const method = {
    name: 'Main', result: 'int', parameters: location === 'arg' ? [type] : [],
    locals: [type, 'Program', type + '[]'],
    body(writer, context) {
      const field = context.fields.get('Program.Value');
      switch (location) {
        case 'local':
          writer.integer(input).op('stloc.0').op('ldloc.0');
          break;
        case 'arg':
          writer.integer(input).op('starg.s', 0).op('ldarg.0');
          break;
        case 'field':
          writer.op('newobj', context.methods.get('Program..ctor')).op('stloc.1');
          writer.op('ldloc.1').integer(input).op('stfld', field).op('ldloc.1').op('ldfld', field);
          break;
        case 'static':
          writer.integer(input).op('stsfld', field).op('ldsfld', field);
          break;
        case 'array':
          writer.integer(1).op('newarr', context.resolve(metadataNames[type])).op('stloc.2');
          writer.op('ldloc.2').integer(0).integer(input).op('stelem.' + suffix.replace('u', 'i'));
          writer.op('ldloc.2').integer(0).op('ldelem.' + suffix);
          break;
        case 'byref':
          writer.op('ldloca.s', 0).integer(input).op('stind.' + suffix.replace('u', 'i'));
          writer.op('ldloca.s', 0).op('ldind.' + suffix);
          break;
        default: throw new Error('Unknown storage location');
      }
      writer.op('ret');
    },
  };
  return controlFixture([{
    name: 'Program', fields: [{name: 'Value', type, flags: location === 'static' ? 0x16 : 6}],
    methods: [method, {
      name: '.ctor', static: false, flags: 0x1886,
      body: (writer, context) => writer.op('ldarg.0')
        .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret'),
    }],
  }]);
}
