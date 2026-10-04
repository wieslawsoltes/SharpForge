import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const fixture = new URL('./fixtures/clr-method-display-nested/native.json', import.meta.url);
test('CLR nested argument displays match independent native MethodInfo strings',
  { skip: !existsSync(fixture) && 'Native capture pending serial validation' }, async () => {
    const native = JSON.parse(readFileSync(fixture));
    assert.equal(native.execution.exitCode, 0);
    const context = new AssemblyLoadSession().createContext();
    const module = (await context.loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
    const records = JSON.parse(native.execution.stdout).records;
    assert.equal(records.length, 8);
    for (const record of records) assert.equal(module.methodDefinition(record.token).toString(), record.text, record.name);
    assert.equal(module.methodBodyReadCount, 0);
    assert.equal(context.assemblies.length, 1);
  });
