import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const fixture = new URL('./fixtures/clr-method-display/native.json', import.meta.url);
test('CLR MethodInfo and ConstructorInfo strings match independent native reflection',
  { skip: !existsSync(fixture) && 'Native capture pending serial validation' }, async () => {
    const native = JSON.parse(readFileSync(fixture));
    assert.equal(native.execution.exitCode, 0);
    const context = new AssemblyLoadSession().createContext();
    const module = (await context.loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
    const records = JSON.parse(native.execution.stdout).records;
    assert.ok(records.some(record => record.name === '.ctor'));
    assert.ok(records.some(record => record.name === '.cctor'));
    for (const record of records) {
      const method = module.methodDefinition(record.token);
      assert.equal(method.toString(), record.text, `${record.owner}.${record.name}`);
      assert.equal(String(method), record.text);
    }
    assert.equal(module.methodBodyReadCount, 0);
    assert.equal(context.assemblies.length, 1);
  });
