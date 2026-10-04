import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AssemblyInspector, CilDispatchTable, genericTypeParts, normalizeCallType, verifyCilAssembly} from '@sharpforge/cil';
import {MethodTableRegistry, runtimeTypeName} from '../packages/runtime/src/execution/method-table.js';
import {qualifyAsyncAssembly} from '../scripts/a05-async-qualification.js';

const fixture = new URL('./fixtures/a05-async/native-sdk8/', import.meta.url);
const bytes = readFileSync(new URL('Qualification.dll', fixture));
const evidence = JSON.parse(readFileSync(new URL('qualification.json', fixture), 'utf8'));
const generated = 'Program+<Echo>d__7`1';

test('Roslyn async regression consumes the exact SDK8 native-qualified DLL and source', () => {
  const digest = data => createHash('sha256').update(data).digest('hex');
  assert.equal(digest(bytes), evidence.assemblySha256);
  assert.equal(digest(readFileSync(new URL('../Program.cs', fixture))), evidence.sources[0].sha256);
  assert.equal(evidence.dotnetSdk, '8.0.425');
  assert.equal(evidence.native.exitCode, 0);
  assert.equal(evidence.native.signal, null);
  assert.equal(evidence.native.output, evidence.expectedOutput);
  assert.equal(evidence.passed, false, 'Preserve the original failed VM qualification honestly');
});

test('generic suffix parsing preserves generated CLI identifiers and nested argument lists', () => {
  assert.deepEqual(genericTypeParts(generated + '<!!0>'), {definition: generated, arguments: ['!!0']});
  assert.deepEqual(genericTypeParts(generated), {definition: generated, arguments: []});
  assert.deepEqual(genericTypeParts('<PrivateImplementationDetails>'),
    {definition: '<PrivateImplementationDetails>', arguments: []});
  assert.deepEqual(genericTypeParts('Program+<>c'), {definition: 'Program+<>c', arguments: []});
  const type = generated + '<System.Collections.Generic.Dictionary`2<System.String,System.Int32[]>>';
  assert.equal(normalizeCallType(type), generated + '<System.Collections.Generic.Dictionary`2<string,int[]>>');
  assert.equal(runtimeTypeName(generated + '<int>'), generated + '<System.Int32>');
  for (const invalid of ['List<int', 'List<int>>', generated + '<int', generated + '<int]>']) {
    assert.throws(() => runtimeTypeName(invalid), /Unbalanced/);
  }
});

test('generated generic method tables retain exact definitions, closed fields and argument limits', () => {
  const registry = new MethodTableRegistry();
  registry.define({name: generated, token: 0x02000004, genericArity: 1,
    base: 'System.ValueType', flags: {valueType: true}, fields: [{name: 'value', type: '!0'}]});
  const closed = registry.get(generated + '<int>');
  assert.equal(closed.genericDefinition, registry.get(generated));
  assert.equal(closed.definitionToken, 0x02000004);
  assert.equal(closed.fields[0].type, registry.get('int'));
  assert.equal(closed.containsGenericParameters, false);
  assert.throws(() => registry.get(generated + '<int,string>'), /argument count/);
});

test('actual Roslyn generic iterator MethodImpl rows resolve specialized external slots', () => {
  const inspector = new AssemblyInspector(bytes), dispatch = new CilDispatchTable(inspector);
  const iterator = inspector.types.find(type => type.name === 'Program+<Values>d__8');
  assert(iterator);
  const table = dispatch.table(iterator.token);
  for (const [owner, name, result] of [
    ['System.Collections.Generic.IEnumerator`1<int>', 'get_Current', 'int'],
    ['System.Collections.Generic.IEnumerable`1<int>', 'GetEnumerator', 'System.Collections.Generic.IEnumerator`1<int>']
  ]) {
    const detail = [...table.declarationDetails.values()].find(item => item.external && item.owner === owner && item.name === name);
    assert(detail, owner + '::' + name);
    assert.equal(detail.signature.returnType, result);
    assert(inspector.methods.get(dispatch.resolveSlot(table, detail.slot))?.hasBody);
  }
  const report = verifyCilAssembly(inspector);
  assert.equal(report.success, true, JSON.stringify(report.issues));
});

test('actual Roslyn iterator still rejects a duplicated MethodImpl declaration', () => {
  const inspector = new AssemblyInspector(bytes);
  const iterator = inspector.types.find(type => type.name === 'Program+<Values>d__8');
  const row = inspector.metadata.rows[25].find(item => item[0] === (iterator.token & 0xffffff));
  inspector.metadata.rows[25].push([...row]);
  assert.throws(() => new CilDispatchTable(inspector).table(iterator.token), /duplicate MethodImpl/);
});

test('actual SDK8 async and iterator output survives both same-machine await snapshots and portable replay', async () => {
  const {result, replays} = await qualifyAsyncAssembly(bytes);
  assert.equal(result.output, evidence.native.output);
  assert.equal(result.exitCode, evidence.native.exitCode);
  assert.deepEqual(replays.map(item => [item.await, item.kind]), [[1, 'local'], [1, 'portable'], [2, 'local'], [2, 'portable']]);
  for (const replay of replays) {
    assert.equal(replay.output, evidence.native.output);
    assert.equal(replay.exitCode, evidence.native.exitCode);
  }
});
