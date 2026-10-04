import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, Op} from '@sharpforge/bytecode';
import {AssemblyInspector, codedIndex, emitAssemblyDetailed, loadAssembly, methodSignature, readSignature} from '@sharpforge/cil';
import {VirtualMachine} from '@sharpforge/runtime';
import {decodeObjectBuiltin} from '../packages/cil/src/object-builtin-mapping.js';
import {managedFixture} from './managed-fixtures.js';

const identities = [
  {name: 'System.Runtime', token: 'b03f5f7f11d50a3a'},
  {name: 'System.Private.CoreLib', token: '7cec85d7bea7798e'},
  {name: 'mscorlib', token: 'b77a5c561934e089'}
];
const keyBytes = text => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16));

/** Independent metadata rows exercise scope and raw type identity before canonical profile reconstruction. */
function fixture(options = {}) {
  const identity = {...identities[0], version: [10, 1, 2, 3], culture: '', flags: 0, ...options.identity};
  let memberToken, ownerToken;
  const bytes = managedFixture({methods: [{name: 'Main', result: 'object', body(writer, context) {
    const metadata = context.md;
    const assembly = metadata.add(35, [...identity.version, identity.flags, metadata.blob(keyBytes(identity.token)),
      metadata.string(identity.name), metadata.string(identity.culture), 0]);
    let scope = assembly;
    if (options.scope === 'nested') {
      scope = metadata.add(1, [codedIndex('ResolutionScope', assembly), metadata.string('Outer'), metadata.string('Fixture')]);
    } else if (options.scope === 'module') scope = 0;
    ownerToken = metadata.add(1, [codedIndex('ResolutionScope', scope),
      metadata.string(options.name ?? 'Object'), metadata.string(options.namespace ?? 'System')]);
    memberToken = metadata.member(ownerToken, '.ctor',
      options.signatureBytes ?? methodSignature(options.result ?? 'void', [], false, context.resolve));
    writer.op('newobj', memberToken).op('ret');
  }}]});
  const inspector = new AssemblyInspector(bytes), metadata = inspector.metadata;
  const call = inspector.getMethod(inspector.pe.entryPoint).instructions.find(instruction => instruction.name === 'newobj');
  const target = {token: memberToken, owner: metadata.typeName(ownerToken), name: '.ctor',
    sig: readSignature(metadata.blob(metadata.row(memberToken)[2]), metadata)};
  return {target, call, span: [call], metadata};
}

const decode = ({target, call, span, metadata}) => decodeObjectBuiltin(target, call, span, metadata);

test('Object constructor decoder admits each pinned facade identity without rewriting its version', () => {
  for (const identity of identities) assert.equal(decode(fixture({identity})), 'object.new', identity.name);
});

test('Object constructor decoder requires an exact zero-argument newobj and rejects ordinary base calls', () => {
  const input = fixture();
  assert.equal(decode(input), 'object.new');
  for (const name of ['call', 'callvirt']) {
    const call = {...input.call, name};
    assert.equal(decode({...input, call, span: [call]}), null, name);
  }
  for (const replacement of [{kind: 'field'}, {isStatic: true}, {returnType: 'object'}, {parameters: ['int']},
    {genericArity: 1}, {callingConvention: 5}, {explicitThis: true}, {sentinel: 0}]) {
    assert.equal(decode({...input, target: {...input.target, sig: {...input.target.sig, ...replacement}}}), null);
  }
  for (const span of [[], [input.call, {name: 'nop'}], [input.call, input.call], [{name: 'ldnull'}, input.call]]) {
    assert.equal(decode({...input, span}), null);
  }
  const wrongCall = {...input.call, operand: input.call.operand + 1};
  assert.equal(decode({...input, call: wrongCall, span: [wrongCall]}), null);
  assert.equal(decode({...input, target: {...input.target, token: 0x06000001}}), null);
  assert.equal(decode({...input, target: {...input.target, name: 'new'}}), null);
});

test('Object constructor decoder rejects forged raw namespaces, names and nested or module scopes', () => {
  for (const options of [{name: 'ObjectLookalike'}, {namespace: 'Other'}, {scope: 'nested'}]) {
    assert.equal(decode(fixture(options)), null, JSON.stringify(options));
  }
  assert.throws(() => decode(fixture({name: 'System.Object', namespace: ''})), /declaring type identity/);
  assert.throws(() => decode(fixture({scope: 'module'})), /unapproved assembly identity/);
  const nested = fixture({scope: 'nested'});
  assert.throws(() => decode({...nested, target: {...nested.target, owner: 'System.Object'}}), /unapproved assembly identity/);
});

test('Object constructor decoder checks raw signature details omitted by the display signature', () => {
  const explicitThis = fixture({signatureBytes: Uint8Array.of(0x60, 0x00, 0x01)});
  assert.equal(explicitThis.target.sig.isStatic, false);
  assert.equal(explicitThis.target.sig.returnType, 'void');
  assert.equal(explicitThis.target.sig.explicitThis, undefined);
  assert.equal(decode(explicitThis), null);
  for (const result of ['class System.Void', 'valuetype System.Void']) {
    const input = fixture({result});
    assert.equal(input.target.sig.returnType, 'void');
    assert.equal(decode(input), null, result);
  }
});

test('Object constructor decoder rejects forged keys, cultures, flags and facade names', () => {
  for (const identity of [
    {token: ''}, {token: '0000000000000000'}, {culture: 'en-US'}, {flags: 0x100},
    {flags: 1, token: '00000000000000000000000000000000'},
    {name: 'Lookalike.Runtime'}, {name: 'System'}
  ]) assert.throws(() => decode(fixture({identity})), /unapproved assembly identity/, JSON.stringify(identity));
});

function sourceProgram() {
  const program = compileToIL('class Program { static void Main() { new object(); } }');
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

test('Object constructor canonical reload preserves zero arguments in net8 and mscorlib4 profiles', () => {
  const program = sourceProgram();
  for (const framework of ['net8', 'mscorlib4']) {
    const bytes = emitAssemblyDetailed(program.image, {framework}).bytes;
    const image = loadAssembly(bytes);
    const operands = image.methods.flatMap(method => {
      const found = [];
      for (let offset = 0; offset < method.code.length; offset += 3) {
        if (method.code[offset] === Op.BUILTIN && method.code[offset + 1] === BuiltinMap.get('object.new').id) {
          found.push(method.code[offset + 2]);
        }
      }
      return found;
    });
    assert.deepEqual(operands, [0]);
    const vm = new VirtualMachine(image);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.heap.stats.allocations, 1);
    } finally { vm.stop(); }
  }
});

test('canonical reload rejects a forged AssemblyRef even when canonical replay could reproduce it', () => {
  const program = sourceProgram();
  for (const replacement of [{publicKeyOrToken: new Uint8Array(8)}, {culture: 'en-US'}]) {
    const reference = {name: 'System.Runtime', version: [8, 0, 0, 0], culture: '', flags: 0,
      publicKeyOrToken: keyBytes(identities[0].token), ...replacement};
    const bytes = emitAssemblyDetailed(program.image, {assemblyReferences: [reference]}).bytes;
    assert.throws(() => loadAssembly(bytes), /Object constructor has an unapproved assembly identity/);
  }
});
