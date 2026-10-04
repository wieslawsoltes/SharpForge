import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const fixture = new URL('./fixtures/clr-parameter-display/native.json', import.meta.url);
test('CLR ParameterInfo displays match native argument, return, constructor and property strings', async () => {
  const native = JSON.parse(readFileSync(fixture));
  const image = Buffer.from(native.image, 'base64');
  const source = readFileSync(new URL('./fixtures/clr-parameter-display/Program.cs', import.meta.url));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(native.sourceSHA256, hash(source));
  assert.equal(native.compilation.exitCode, 0);
  assert.equal(native.compilation.assemblySHA256, hash(image));
  assert.equal(native.execution.exitCode, 0);
  const context = new AssemblyLoadSession().createContext();
  const module = (await context.loadFromStream(image)).manifestModule;
  const records = JSON.parse(native.execution.stdout).records;
  assert.equal(records.length, 16);
  for (const record of records) {
    const member = record.kind === 'property' ? module.propertyDefinition(record.token) : module.methodDefinition(record.token);
    const parameters = record.kind === 'property' ? member.indexParameters : member.parameters;
    const parameter = record.position === -1 ? member.returnParameter : parameters[record.position];
    assert.equal(parameter.name, record.parameterName);
    assert.equal(parameter.toString(), record.text, `${record.name}:${record.position}`);
    assert.equal(String(parameter), record.text);
  }
  assert.equal(module.methodBodyReadCount, 0);
  assert.equal(context.assemblies.length, 1);
});
