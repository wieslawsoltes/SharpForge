import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile, compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {Op, verifyImage} from '@sharpforge/bytecode';

const directory = new URL('./fixtures/a05-source-refs/', import.meta.url);
const source = readFileSync(new URL('Program.cs', directory), 'utf8');
const expected = readFileSync(new URL('expected.txt', directory), 'utf8');
for (const engine of ['source', 'reloaded', 'cil']) {
  test('T02.8 ' + engine + ': source references alias fields, elements, ref returns and ref locals', () => {
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly) :
      new VirtualMachine(engine === 'source' ? compiled.image : loadAssembly(compiled.assembly));
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, expected);
  });
}

test('T02.8 readonly writes and escaping local references are source diagnostics', () => {
  for (const body of [
    'static void Bad(in int value) { value = 4; }',
    'static ref int Bad() { int local = 1; return ref local; }'
  ]) {
    const compiled = compile('class Program { ' + body + ' static void Main() {} }');
    assert.equal(compiled.success, false);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  }
});

test('T02.8 malformed indirect storage is rejected by bytecode verification', () => {
  const compiled = compile('class Program { static void Main() { int value = 1; } }');
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const image = compiled.image;
  image.methods[image.entryPoint].code = Int32Array.from([Op.CONST, 0, 0, Op.LDIND, -1, 0, Op.RET, 0, 0]);
  assert(verifyImage(image).some(message => /Invalid memory instruction/.test(message)));
});
