import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, CilDispatchTable, codedIndex, methodSignature, methodSpecSignature, verifyCilAssembly} from '@sharpforge/cil';
import {asyncMethodDefinition, asyncTypes} from '../packages/cil/src/async-profile.js';
import {managedFixture} from './managed-fixtures.js';

function member(name, parameters, returnType, options = {}) {
  return {kind: 'method', owner: asyncTypes.builder, name, ...options,
    signature: {isStatic: false, callingConvention: 0, genericArity: 0, parameters, returnType, ...options.signature}};
}

test('CIL async ABI matcher requires complete generic and byref member signatures', () => {
  const start = member('Start', ['Fixture.Program&'], 'void', {genericArguments: ['Fixture.Program'],
    methodArguments: ['Fixture.Program'], signature: {genericArity: 1}});
  assert.equal(asyncMethodDefinition(start)?.operation, 'start');
  for (const candidate of [
    {...start, owner: 'User.AsyncTaskMethodBuilder'},
    {...start, resolvedToken: 0x06000001},
    {...start, genericArguments: undefined},
    {...start, signature: {...start.signature, isStatic: true}},
    {...start, signature: {...start.signature, genericArity: 0}},
    {...start, signature: {...start.signature, parameters: ['Fixture.Program']}},
    {...start, signature: {...start.signature, returnType: 'int'}}
  ]) assert.equal(asyncMethodDefinition(candidate), null);
});

test('CIL async ABI generic awaiter result and real Yield type are exact', () => {
  const generic = member('GetAwaiter', [], asyncTypes.awaiter + '`1<int>',
    {owner: asyncTypes.task + '`1<int>'});
  assert.equal(asyncMethodDefinition(generic)?.operation, 'getAwaiter');
  assert.equal(asyncMethodDefinition({...generic, signature: {...generic.signature, returnType: asyncTypes.awaiter + '`1<string>'}}), null);
  const yieldCall = member('Yield', [], asyncTypes.yieldable, {owner: asyncTypes.task, signature: {isStatic: true}});
  assert.equal(asyncMethodDefinition(yieldCall)?.operation, 'yield');
  assert.equal(asyncMethodDefinition({...yieldCall, signature: {...yieldCall.signature, returnType: asyncTypes.task}}), null);
});

test('CIL async matching preserves caller generic variables in an already substituted state-machine argument', () => {
  const machine = 'Program+<Echo>d__7`1<!!0>';
  const start = member('Start', [machine + '&'], 'void', {
    owner: asyncTypes.builder + '`1<!!0>',
    genericArguments: [machine], methodArguments: [machine], signature: {genericArity: 1}
  });
  const definition = asyncMethodDefinition(start);
  assert.equal(definition?.operation, 'start');
  assert.equal(definition.runtimeOperation, 'builder-start');
  assert.deepEqual(definition.signature.parameters, [machine + '&']);
  assert.deepEqual(definition.methodArguments, [machine]);
  const wrong = 'Program+<Echo>d__7`1<' + machine + '>&';
  assert.equal(asyncMethodDefinition({...start, signature: {...start.signature, parameters: [wrong]}}), null);
});

function machineFixture({assembly = 'System.Runtime', badDeclaration = false, invalidBody = false,
  wrongKey = false, localContract = false, explicit = false, duplicate = false} = {}) {
  return managedFixture({methods: [
    {name: 'Main', locals: [asyncTypes.builder, 'Fixture.Program'], body(writer, context) {
      const {md, resolve} = context;
      const builder = md.typeRef(asyncTypes.builder, assembly);
      const start = md.member(builder, 'Start', methodSignature('void', ['!!0&'], false, resolve, {genericArity: 1}));
      const specialized = md.add(43, [codedIndex('MethodDefOrRef', start), md.blob(methodSpecSignature(['Fixture.Program'], resolve))]);
      writer.op('ldloca.s', 0).op('ldloca.s', 1).op('call', specialized).op('ret');
    }},
    {name: 'MoveNext', static: false, flags: 0xc6, body(writer) { if (invalidBody) writer.op('pop'); writer.op('ret'); }},
    {name: 'SetStateMachine', static: false, flags: 0xc6, parameters: [asyncTypes.machine], body: writer => writer.op('ret')}
  ], decorate(context) {
    const {md, type, methods, resolve} = context;
    const contract = localContract ? md.add(2, [0xa1, md.string('IAsyncStateMachine'), md.string('System.Runtime.CompilerServices'),
      0, (md.rows[4]?.length ?? 0) + 1, md.rows[6].length + 1]) : md.typeRef(asyncTypes.machine);
    md.add(9, [type & 0xffffff, codedIndex('TypeDefOrRef', contract)]);
    if (wrongKey) md.rows[35][0][5] = md.blob(new Uint8Array(8));
    if (badDeclaration || explicit || duplicate) {
      const declaration = md.member(contract, 'MoveNext', methodSignature(badDeclaration ? 'int' : 'void', [], false, resolve));
      md.add(25, [type & 0xffffff, codedIndex('MethodDefOrRef', methods.MoveNext), codedIndex('MethodDefOrRef', declaration)]);
      if (duplicate) md.add(25, [type & 0xffffff, codedIndex('MethodDefOrRef', methods.MoveNext), codedIndex('MethodDefOrRef', declaration)]);
    }
  }});
}

test('CIL async callbacks require trusted reference scope and matching MethodImpl declarations', () => {
  assert.equal(verifyCilAssembly(machineFixture()).success, true);
  for (const options of [{assembly: 'Impostor.Runtime'}, {wrongKey: true}, {badDeclaration: true}, {localContract: true}, {duplicate: true}]) {
    const result = verifyCilAssembly(machineFixture(options));
    assert.equal(result.success, false);
    assert.ok(result.issues.some(issue => issue.code === 'IL_TOKEN' && /identity|MethodImpl|admitted/.test(issue.message)), result.issues);
  }
});

test('CIL dispatch admits proved async callback implementations and still rejects malformed declarations', () => {
  const inspector = new AssemblyInspector(machineFixture({explicit: true}));
  assert.ok(new CilDispatchTable(inspector).table(0x02000002));
  for (const options of [{badDeclaration: true}, {duplicate: true}, {explicit: true, wrongKey: true}, {explicit: true, localContract: true}]) {
    assert.throws(() => new CilDispatchTable(new AssemblyInspector(machineFixture(options))).table(0x02000002));
  }
});

test('CIL async callback-only bodies remain mandatory verifier roots', () => {
  const result = verifyCilAssembly(machineFixture({invalidBody: true}));
  assert.equal(result.success, false);
  assert.ok(result.issues.some(issue => issue.method.endsWith('::MoveNext') && issue.code === 'IL_STACK'), result.issues);
});
