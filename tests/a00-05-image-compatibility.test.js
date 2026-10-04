import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deserializeImage, Op, verifyImage} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';
import {validate} from '../scripts/planning/schema/validate.js';

const fixture = new URL('../planning/contracts/fixtures/schema/nested-finally.image.json', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('../planning/contracts/schema/bytecode-image.v2.schema.json', import.meta.url)));

for (const legacy of [false, true]) {
  test(`A00 nested-finally image accepts ${legacy ? 'legacy alias and inferred' : 'canonical and explicit'} catch boundary`, () => {
    const document = JSON.parse(readFileSync(fixture, 'utf8'));
    const method = document.methods[0];
    const handler = method.handlers.find(region => region.type === 'System.Exception');
    assert.equal(handler.target, 11);
    assert.equal(handler.handlerEnd, 16);
    assert.equal(method.code.$int32[(handler.handlerEnd - 1) * 3], Op.JUMP);
    assert.equal(method.code.$int32[(handler.handlerEnd - 1) * 3 + 1], handler.handlerEnd);
    // The earlier image inferred this exact exclusive boundary from the protected-region exit.
    assert.equal(method.code.$int32[handler.end * 3], Op.JUMP);
    assert.equal(method.code.$int32[handler.end * 3 + 1], handler.handlerEnd);
    if (legacy) {
      delete handler.handlerEnd;
      handler.type = 'Exception';
      method.locals[0].type = 'Exception';
    }
    validate(schema, document);
    const image = deserializeImage(JSON.stringify(document));
    assert.deepEqual(verifyImage(image), []);
    const vm = new VirtualMachine(image, {virtualTime: true});
    try {
      vm.run();
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.fault, null);
      assert.equal(vm.output.join(''), 'inner\ncatch\nouter\n');
    } finally { vm.stop(); }
  });
}
