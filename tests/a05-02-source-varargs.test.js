import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile, compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {Op, verifyImage} from '@sharpforge/bytecode';

const directory = new URL('./fixtures/a05-source-varargs/', import.meta.url);
const source = readFileSync(new URL('Program.cs', directory), 'utf8');
const expected = readFileSync(new URL('expected.txt', directory), 'utf8');

for (const engine of ['source', 'reloaded', 'cil']) {
  test('T02.9 ' + engine + ': optional slots and typed references preserve types, aliases and copies', () => {
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const image = engine === 'reloaded' ? loadAssembly(compiled.assembly) : compiled.image;
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly) : new VirtualMachine(image);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, expected);
    if (engine !== 'cil') {
      const method = image.methods.find(method => method.name === 'Total');
      assert.equal(method.callingConvention, 5);
      assert.equal(method.parameters.length, 1);
    }
  });
}

test('T02.9 invalid argument handles and nonvariable typed-reference operands are source diagnostics', () => {
  for (const member of [
    'static void Bad() { System.ArgIterator iterator = new System.ArgIterator(__arglist); }',
    'static void Bad() { System.TypedReference value = __makeref(1); }',
    'static void Bad(in int value) { System.TypedReference reference = __makeref(value); }',
    'static void Bad(__arglist, int value) {}'
  ]) {
    const compiled = compile('class Program { ' + member + ' static void Main() {} }');
    assert.equal(compiled.success, false, member);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  }
});

test('T02.9 bytecode cannot acquire a varargs handle from an ordinary frame', () => {
  const compiled = compile('class Program { static void Main() {} }');
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const image = compiled.image;
  image.methods[image.entryPoint].code = Int32Array.from([Op.ARGLIST, 0, 0, Op.RET, 0, 0]);
  assert(verifyImage(image).some(message => /Invalid memory instruction/.test(message)));
});
