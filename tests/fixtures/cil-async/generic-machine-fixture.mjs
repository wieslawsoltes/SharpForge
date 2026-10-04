/** Independently authored metadata controls; no C# compiler or runtime lowering produces these images. */
import {codedIndex, methodSignature, methodSpecSignature} from '@sharpforge/cil';
import {managedFixture} from '../../managed-fixtures.js';

const builder = 'System.Runtime.CompilerServices.AsyncTaskMethodBuilder';
const machine = 'System.Runtime.CompilerServices.IAsyncStateMachine';
const constructed = arguments_ => ({kind: 'genericInstance', type: {kind: 'valuetype', token: 0x02000003},
  arguments: arguments_.map(name => ({kind: 'primitive', name}))});

export function genericMachineFixture({outOfRangeVariable = false, wrongArity = false, badReturn = false,
  badParameter = false, substitutedBody = false, declarationAssembly = 'System.Runtime', wrongKey = false,
  untrustedBodyParameter = false, typeName = 'Machine`1', genericArity = 1, owners = []} = {}) {
  const arguments_ = Array.from({length: genericArity}, (_, index) => index ? 'string' : 'int');
  return managedFixture({name: 'GenericMachineProof', methods: [
    {name: 'Main', locals: [builder, constructed(arguments_)], body(writer, {md, resolve}) {
      const start = md.member(md.typeRef(builder), 'Start', methodSignature('void', ['!!0&'], false, resolve, {genericArity: 1}));
      const argument = constructed(wrongArity ? [...arguments_, 'string'] : arguments_);
      const call = md.add(43, [codedIndex('MethodDefOrRef', start), md.blob(methodSpecSignature([argument], resolve))]);
      writer.op('ldloca.s', 0).op('ldloca.s', 1).op('call', call).op('ret');
    }},
    {name: 'Step', static: false, flags: 0xc6,
      locals: ['!' + (outOfRangeVariable ? genericArity : genericArity - 1)], body: writer => writer.op('ret')},
    {name: 'Bind', static: false, flags: 0xc6, parameters: [substitutedBody ? '!0' : machine], body: writer => writer.op('ret')},
  ], decorate({md, methods, resolve}) {
    // Program owns only Main; Machine<T> owns the subsequent callback MethodDefs.
    const type = md.add(2, [owners.length ? 0x10010b : 0x100109, md.string(typeName), owners.length ? 0 : md.string('Fixture'),
      codedIndex('TypeDefOrRef', md.typeRef('System.ValueType')), 1, 2]);
    for (let index = 0; index < genericArity; index++) {
      md.add(42, [index, 0, codedIndex('TypeOrMethodDef', type), md.string('T' + index)]);
    }
    let parent = null;
    for (const owner of owners) {
      if (owner.token) {
        parent = owner.token;
        continue;
      }
      const enclosing = md.add(2, [parent ? 0x100002 : 0x100001, md.string(owner.name), parent ? 0 : md.string('Fixture'),
        codedIndex('TypeDefOrRef', md.typeRef('System.Object')), 1, 4]);
      for (let index = 0; index < owner.arity; index++) {
        md.add(42, [index, 0, codedIndex('TypeOrMethodDef', enclosing), md.string('T' + index)]);
      }
      if (parent) md.add(41, [enclosing & 0xffffff, parent & 0xffffff]);
      parent = enclosing;
    }
    if (parent) md.add(41, [type & 0xffffff, parent & 0xffffff]);
    md.add(9, [type & 0xffffff, codedIndex('TypeDefOrRef', md.typeRef(machine))]);
    const contract = md.typeRef(machine, declarationAssembly);
    if (wrongKey) {
      const reference = md.rows[35][(md.assemblyRef(declarationAssembly) & 0xffffff) - 1];
      reference[5] = md.blob(new Uint8Array(8));
    }
    if (untrustedBodyParameter) {
      const impostor = {kind: 'class', token: md.typeRef(machine, 'Impostor.Runtime')};
      md.rows[6][(methods.Bind & 0xffffff) - 1][4] = md.blob(methodSignature('void', [impostor], false, resolve));
    }
    const declarations = [
      ['Step', 'MoveNext', badReturn ? 'int' : 'void', []],
      ['Bind', 'SetStateMachine', 'void', [badParameter ? 'System.Action' : machine]],
    ];
    for (const [body, name, result, parameters] of declarations) {
      const declaration = md.member(contract, name, methodSignature(result, parameters, false, resolve));
      md.add(25, [type & 0xffffff, codedIndex('MethodDefOrRef', methods[body]), codedIndex('MethodDefOrRef', declaration)]);
    }
  }});
}
