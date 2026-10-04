import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const fixture = new URL('./fixtures/clr-method-display-nested/native.json', import.meta.url);
test('CLR nested argument displays match independent native MethodInfo strings', async () => {
    const native = JSON.parse(readFileSync(fixture));
    const source = readFileSync(new URL('./fixtures/clr-method-display-nested/Program.cs', import.meta.url));
    const image = Buffer.from(native.image, 'base64');
    assert.equal(native.sourceSHA256, createHash('sha256').update(source).digest('hex'));
    assert.equal(native.compilation.exitCode, 0);
    assert.equal(native.compilation.assemblySHA256, createHash('sha256').update(image).digest('hex'));
    assert.equal(native.execution.exitCode, 0);
    const context = new AssemblyLoadSession().createContext();
    const module = (await context.loadFromStream(image)).manifestModule;
    const records = JSON.parse(native.execution.stdout).records;
    assert.equal(records.length, 8);
    for (const record of records) assert.equal(module.methodDefinition(record.token).toString(), record.text, record.name);
    assert.equal(module.methodBodyReadCount, 0);
    assert.equal(context.assemblies.length, 1);
  });
