import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync
} from 'node:fs';
import {
  compile,
  compileToIL
} from '@sharpforge/compiler';
import {
  loadAssembly
} from '@sharpforge/cil';
import {
  VirtualMachine,
  CilVirtualMachine
} from '@sharpforge/runtime';
import {
  Op,
  verifyImage
} from '@sharpforge/bytecode';

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
  assert(verifyImage(image).some(message => /arglist requires a vararg method/.test(message)));
});

for (const engine of ['source', 'reloaded', 'cil']) {
  test(`T02.9 ${engine}: optional ref arguments retain their caller location`, () => {
    const compiled = compileToIL(`using System; class Program {
      static void Update(__arglist) {
        ArgIterator iterator = new ArgIterator(__arglist);
        __refvalue(iterator.GetNextArg(), int) = 31;
      }
      static void Main() { int number = 5; Update(__arglist(ref number)); Console.WriteLine(number); }
    }`);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly) :
      new VirtualMachine(engine === 'source' ? compiled.image : loadAssembly(compiled.assembly));
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '31\n');
  });

  test(`T02.9 ${engine}: variable constructors and ordinary params/default calls retain separate signatures`, () => {
    const compiled = compileToIL(`using System; class Packet {
      public int total;
      public Packet(int initial, __arglist) {
        ArgIterator iterator = new ArgIterator(__arglist);
        total = initial + __refvalue(iterator.GetNextArg(), int);
      }
    } class Program {
      static int Sum(int initial = 5, params int[] values) {
        int total = initial; for (int i = 0; i < values.Length; i++) total += values[i]; return total;
      }
      static void Main() {
        Console.WriteLine(new Packet(4, __arglist(7)).total);
        Console.WriteLine(Sum()); Console.WriteLine(Sum(10, 1, 2));
      }
    }`);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly)
      : new VirtualMachine(engine === 'source' ? compiled.image : loadAssembly(compiled.assembly));
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '11\n5\n13\n');
    const sum = compiled.image.methods.find(method => method.name === 'Sum');
    assert.equal(sum.callingConvention ?? 0, 0);
    assert(compiled.image.methods.some(method => method.code.some((op, index) => index % 3 === 0 && op === Op.NEWARR)));
  });
}

test('T02.9 source varargs preserve C# declaration and operand diagnostics', () => {
  const cases = [
    ['static void Bad<T>(__arglist) {}', 'CS0224'],
    ['static async System.Threading.Tasks.Task Bad(__arglist) { await System.Threading.Tasks.Task.Delay(1); }', 'CS4006'],
    ['static System.Collections.IEnumerable Bad(__arglist) { yield return 1; }', 'CS1636'],
    ['static void Other(__arglist) {} static void Bad() { int x=0; Other(__arglist(in x)); }', 'CS8378'],
    ['static void Other(__arglist) {} static void Bad() { int x; Other(__arglist(x)); }', 'CS0165']
  ];
  for (const [member, code] of cases) {
    const result = compile('class Program { ' + member + ' static void Main() {} }');
    assert.equal(result.success, false, member);
    assert(result.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(result.diagnostics));
  }
});
