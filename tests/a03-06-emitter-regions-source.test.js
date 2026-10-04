import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { emitAssemblyDetailed, loadAssembly, readPE, buildExceptionRegionTree } from '@sharpforge/cil';
import { cases } from './fixtures/a03-emitter-regions/input.js';

for (const fixture of cases) test(`source emitter nested regions: ${fixture.name}`, () => {
  const result = compile(fixture.source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const snapshot = JSON.stringify(result.image.methods.map(method => method.handlers));
  const emitted = emitAssemblyDetailed(result.image);
  const pe = readPE(emitted.bytes);
  for (const method of emitted.debug.methods) {
    const body = pe.methodBody(method.token);
    assert.doesNotThrow(() => buildExceptionRegionTree(body.code, body.handlers));
  }
  for (const image of [result.image, loadAssembly(emitted.bytes)]) {
    const execution = new VirtualMachine(image).run();
    assert.equal(execution.state, 'terminated', execution.fault?.message);
    assert.equal(execution.output, fixture.expected);
  }
  assert.equal(JSON.stringify(result.image.methods.map(method => method.handlers)), snapshot);
});

