import {findContracts} from '@sharpforge/framework';
import {Op, frameworkBuiltin} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../../managed-fixtures.js';
import {sourceImage} from '../a07/legacy-builtin-engines.js';

const documentType = 'System.Text.Json.JsonDocument';
const elementType = 'System.Text.Json.JsonElement';
const contract = (owner, name, isStatic = false) => findContracts(owner, name, isStatic)[0];
const parse = frameworkBuiltin(contract(documentType, 'Parse', true));
const root = frameworkBuiltin(contract(documentType, 'get_RootElement'));
const dispose = frameworkBuiltin(contract(documentType, 'Dispose'));
const property = frameworkBuiltin(contract(elementType, 'GetProperty'));
const item = frameworkBuiltin(contract(elementType, 'get_Item'));

function sourceReader(text, descriptor, path, disposed) {
  const accessor = frameworkBuiltin(descriptor);
  const image = sourceImage({name: accessor.name, args: [text, ...path], result: descriptor.result});
  const code = [
    Op.CONST, 0, 0, Op.BUILTIN, parse.id, 1, Op.STLOC, 0, 0, Op.BUILTIN, root.id, 1
  ];
  for (let index = 0; index < path.length; index++) {
    const member = typeof path[index] === 'string' ? property : item;
    code.push(Op.CONST, index + 1, 0, Op.BUILTIN, member.id, 2);
  }
  if (disposed) code.push(Op.LDLOC, 0, 0, Op.BUILTIN, dispose.id, 1, Op.POP, 0, 0);
  code.push(Op.BUILTIN, accessor.id, 1, Op.RET, 0, 0);
  image.methods[0].locals = [{name: 'document', type: documentType}];
  image.methods[0].code = Int32Array.from(code);
  return new VirtualMachine(image);
}

function assemblyReader(descriptor, path, disposed) {
  return managedFixture({methods: [{
    name: 'Main', parameters: ['string'], result: descriptor.result, locals: [documentType], maxStack: 2,
    body(writer, context) {
      writer.op('ldarg.0').op('call', context.member(documentType, 'Parse', documentType, ['string']));
      writer.op('stloc.0').op('ldloc.0');
      writer.op('callvirt', context.member(documentType, 'get_RootElement', elementType, [], false));
      for (const segment of path) {
        const named = typeof segment === 'string';
        if (named) writer.op('ldstr', 0x70000000 + context.md.userString(segment));
        else writer.op('ldc.i4', segment);
        writer.op('callvirt', context.member(elementType, named ? 'GetProperty' : 'get_Item',
          elementType, [named ? 'string' : 'int'], false));
      }
      if (disposed) writer.op('ldloc.0').op('callvirt', context.member(documentType, 'Dispose', 'void', [], false));
      writer.op('callvirt', context.member(elementType, descriptor.name, descriptor.result, [], false)).op('ret');
    }
  }]});
}

/** Build a real VM reader without depending on the source compiler's Int64 or typed-catch capabilities. */
export function jsonReader(engine, text, {accessor = 'GetInt64', path = [], disposed = false} = {}) {
  const descriptor = contract(elementType, accessor);
  return engine === 'source' ? sourceReader(text, descriptor, path, disposed)
    : new CilVirtualMachine(assemblyReader(descriptor, path, disposed), {arguments: [text]});
}
