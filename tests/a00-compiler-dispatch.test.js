import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {MethodCompiler} from '../packages/compiler/src/method-compiler.js';

function harness(Compiler = MethodCompiler) {
  const diagnostics = [];
  const constants = [];
  const compilation = {
    options: {}, sources: new Map(), methods: [],
    constant(value) { constants.push(value); return constants.length - 1; },
    report(node, code, args) { diagnostics.push({node, code, args}); },
    findType() { return null; },
    resolveType(type) { return type; },
    typeName(type) { return type; }
  };
  const method = {isStatic: true, parameters: [], node: {}, name: 'Probe', returnType: 'void'};
  return {compiler: new Compiler(compilation, method), diagnostics, constants};
}

const literal = (value, type = 'int') => ({kind: 'Literal', value, type});

test('A00-T13 absent nodes keep statement, inference and expression recovery behavior', () => {
  const {compiler, diagnostics, constants} = harness();
  assert.equal(compiler.stmt(null), undefined);
  assert.equal(compiler.infer(null), 'error');
  assert.deepEqual(compiler.code, []);
  assert.equal(compiler.expr(null), 'error');
  assert.deepEqual(constants, [null]);
  assert.deepEqual(compiler.code, [Op.CONST, 0, 0]);
  assert.deepEqual(diagnostics, []);
});

test('A00-T13 inherited and non-string kinds keep the unknown-node diagnostic fallback', () => {
  const kinds = ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', undefined, 0,
    Symbol('Literal'), {toString() { throw new Error('kind must not be coerced'); }}];
  for (const kind of kinds) {
    const {compiler, diagnostics, constants} = harness();
    const node = {kind};
    assert.equal(compiler.stmt(node), undefined);
    assert.equal(compiler.infer(node), 'error');
    assert.equal(compiler.expr(node), 'error');
    assert.deepEqual(diagnostics, [
      {node, code: 'SF2099', args: [kind]}, {node, code: 'SF2098', args: [kind]}
    ]);
    assert.deepEqual(constants, [null]);
    assert.deepEqual(compiler.code, [Op.CONST, 0, 0]);
  }
});

test('A00-T13 framework hooks keep precedence and receive the composed compiler instance', () => {
  class HookCompiler extends MethodCompiler {
    frameworkInfer(node) {
      assert.equal(this.m.name, 'Probe');
      return node.kind === 'Literal' ? 'framework-type' : super.frameworkInfer(node);
    }
    frameworkExpression(node) {
      assert.equal(this.m.name, 'Probe');
      if (node.kind !== 'Literal') return super.frameworkExpression(node);
      this.emitConstant('framework-value');
      return 'framework-type';
    }
  }
  const {compiler, constants, diagnostics} = harness(HookCompiler);
  assert.equal(compiler.infer(literal(1)), 'framework-type');
  assert.equal(compiler.expr(literal(1)), 'framework-type');
  assert.deepEqual(constants, ['framework-value']);
  assert.deepEqual(diagnostics, []);
  // ModernCompiler still intercepts a lowered temporary before the core dispatch.
  assert.equal(compiler.expr({kind: 'BoundTemp', slot: 7, type: 'int'}), 'int');
  assert.deepEqual(compiler.code.slice(-3), [Op.LDLOC, 7, 0]);
});

test('A00-T13 checked aliases restore the surrounding context on success and exceptions', () => {
  const failure = new Error('probe');
  class ThrowingCompiler extends MethodCompiler {
    expr(node) { if (node?.kind === 'Explode') throw failure; return super.expr(node); }
    stmt(node) { if (node?.kind === 'Explode') throw failure; return super.stmt(node); }
  }
  const {compiler} = harness(ThrowingCompiler);
  for (const previous of [null, true, false]) {
    compiler.checkedContext = previous;
    for (const kind of ['Checked', 'Unchecked']) {
      assert.equal(compiler.expr({kind, expression: literal(2)}), 'int');
      assert.equal(compiler.checkedContext, previous);
      assert.throws(() => compiler.expr({kind, expression: {kind: 'Explode'}}), error => error === failure);
      assert.equal(compiler.checkedContext, previous);
    }
    assert.throws(() => compiler.stmt({kind: 'OverflowContext', checked: true, body: {kind: 'Explode'}}),
      error => error === failure);
    assert.equal(compiler.checkedContext, previous);
  }
});

const program = `
var box = new Box { Value = 0 };
using (box) {
  int[] numbers = new int[] { 1, 2, 3 };
  foreach (int value in numbers) { if (value == 2) continue; box.Add(value); }
  int i = 0;
  while (i < 2) { box.Add(i); i++; }
  do { box.Add(1); i--; } while (i > 0);
  for (int n = 0; n < 3; n++) { if (n == 2) break; box.Add(n); }
  switch (box.Value) { case 8: Console.WriteLine("eight"); break; default: Console.WriteLine("wrong"); break; }
  string missing = null;
  missing ??= "set";
  Console.WriteLine(missing);
  Console.WriteLine(false && box.Add(100) > 0);
  Console.WriteLine(true || box.Add(100) > 0);
  try { throw new Exception("caught"); }
  catch (Exception error) { Console.WriteLine(error.Message); }
  finally { Console.WriteLine(box.Value); }
  Console.WriteLine(box.Value switch { 8 => "match", _ => "wrong" });
  Console.WriteLine(checked((int)2.0) + unchecked(1));
}
class Box : IDisposable {
  public int Value { get; set; }
  public int Add(int amount) { Value += amount; return Value; }
  public void Dispose() { Console.WriteLine("disposed"); }
}
`;

test('A00-T13 grouped control flow, calls, properties and cleanup execute through both pipelines and VMs', () => {
  const expected = 'eight\nset\nFalse\nTrue\ncaught\n8\nmatch\n3\ndisposed\n';
  for (const pipeline of ['legacy', 'bound']) {
    const compiled = compileToIL(program, {pipeline});
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    for (const Engine of [VirtualMachine, CilVirtualMachine]) {
      const input = Engine === VirtualMachine ? compiled.image : compiled.assembly;
      const result = new Engine(input).run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected, `${pipeline}/${Engine.name}`);
    }
  }
});

test('A00-T13 legacy diagnostics survive dispatch for invalid assignment, loop control and arithmetic', () => {
  for (const [source, code] of [
    ['break;', 'CS0139'], ['continue;', 'CS0139'], ['throw;', 'CS0156'],
    ['int value; Console.WriteLine(value);', 'CS0165'],
    ['int value = "bad";', 'CS0029'], ['1 + 2;', 'CS0201'],
    ['int value = checked(2147483647 + 1);', 'CS0220']
  ]) {
    const result = compile(source, {pipeline: 'legacy'});
    assert.equal(result.success, false, source);
    assert(result.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(result.diagnostics));
  }
});
