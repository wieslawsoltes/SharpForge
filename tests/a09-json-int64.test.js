import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compile} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {jsonReader} from './fixtures/json-int64/engines.js';

const directory = new URL('./fixtures/json-int64/', import.meta.url);
const source = readFileSync(new URL('Cases.cs', directory), 'utf8');
const oracle = JSON.parse(readFileSync(new URL('oracle.json', directory), 'utf8'));
const inputDeclaration = /string\[\] values = new string\[\] \{([\s\S]*?)\};/.exec(source);
assert(inputDeclaration, 'Read the exact native input array without changing Cases.cs');
const inputs = JSON.parse('[' + inputDeclaration[1] + ']');
assert.equal(inputs.length, 30);

function read(engine, text, expected, options = {}) {
  const vm = jsonReader(engine, text, options);
  try {
    const result = vm.run();
    if (expected.endsWith('Exception')) {
      assert.equal(result.state, 'faulted', text);
      assert.equal(result.fault.name, expected, text);
      return result.fault.name;
    }
    assert.equal(result.state, 'terminated', result.fault?.stack);
    const value = vm.value(vm.returnValue);
    const type = options.accessor === 'GetRawText' ? 'string'
      : options.accessor === 'GetDouble' || options.accessor === 'GetInt32' ? 'number' : 'bigint';
    assert.equal(typeof value, type, text);
    assert.equal(String(value), expected, text);
    return String(value);
  } finally {
    vm.stop();
  }
}

for (const engine of ['source', 'cil']) {
  test(`SF-A09-B02 ${engine} bytecode GetInt64 matches all 63 native lines and managed types`, () => {
    const lines = [];
    for (const [index, text] of inputs.entries()) {
      lines.push(read(engine, text, oracle.lines[index * 2], {accessor: 'GetRawText'}));
      lines.push(read(engine, text, oracle.lines[index * 2 + 1]));
    }
    const nested = '{"n":9007199254740993,"a":[-9223372036854775808]}';
    lines.push(read(engine, nested, oracle.lines[60], {path: ['n']}));
    lines.push(read(engine, nested, oracle.lines[61], {path: ['a', 0]}));
    lines.push(read(engine, '123', oracle.lines[62], {disposed: true}));
    assert.deepEqual(lines, oracle.lines);
  });

  test(`SF-A09-B02 ${engine} exact Int64 access retains existing Int32 and approximate Double behavior`, () => {
    read(engine, '9007199254740993', '9007199254740993');
    read(engine, '9007199254740993', '9007199254740992', {accessor: 'GetDouble'});
    read(engine, '2147483647', '2147483647', {accessor: 'GetInt32'});
    read(engine, '2147483648', 'FormatException', {accessor: 'GetInt32'});
    read(engine, '1.0', 'FormatException', {accessor: 'GetInt32'});
  });
}

for (const pipeline of ['bound', 'legacy']) {
  test(`SF-A09-B02 ${pipeline} source compiler retains Int64 and typed-catch profile diagnostics`, () => {
    const compiled = compile(source, {pipeline, includeDebug: false});
    assert.equal(compiled.success, false);
    for (const code of ['SF2200', 'SF2002']) {
      assert(compiled.diagnostics.some(item => item.code === code && item.severity === 'error'), code);
    }
  });
}

test('SF-A09-B02 GetInt64 uses the A09 reservation and an actual managed Int64 return', () => {
  const contracts = findContracts('System.Text.Json.JsonElement', 'GetInt64', false);
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].id, 655360);
  assert.equal(contracts[0].result, 'long');
});

test('SF-A09-B02 Int64 reference pins source bytes, SDK, runtime and precision boundaries', () => {
  assert.equal(oracle.sdk, '10.0.201');
  assert.equal(oracle.runtime, '10.0.5');
  assert.equal(oracle.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.ok(oracle.lines.includes('9007199254740993'));
  assert.ok(oracle.lines.includes('-9223372036854775808'));
  assert.ok(oracle.lines.includes('FormatException'));
  assert.equal(oracle.lines.length, 63);
  assert.equal(oracle.lines.at(-1), 'ObjectDisposedException');
});
