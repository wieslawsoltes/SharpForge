import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { arithmeticLibrary, managedFixture } from './managed-fixtures.js';
import { compileProgram, programVM, runProgram } from './a19-runtime-programs.js';

const argvProgram = `using System;
class Program {
  static int Main(string[] args) {
    Console.WriteLine(args.Length);
    for (int index = 0; index < args.Length; index++) Console.WriteLine("[" + args[index] + "]");
    return args.Length;
  }
}`;

for (const engine of ['source', 'cil']) {
  test(engine + ' Main(string[]) receives flat program argv and defaults to an empty array', async () => {
    const compiled = compileProgram(argvProgram);
    assert.equal(new AssemblyInspector(compiled.assembly).metadata.streams.has('#SF'), false);
    const result = await runProgram(compiled, engine, { programArguments: ['one', '', '雪😀'], initialThreshold: 64 });
    assert.equal(result.output, '3\n[one]\n[]\n[雪😀]\n');
    assert.equal(result.exitCode, 3);
    assert.equal((await runProgram(compiled, engine)).output, '0\n');
  });

  test(engine + ' a parameterless entry accepts process argv without injecting method parameters', async () => {
    const compiled = compileProgram('class Program { static int Main() { Console.WriteLine("started"); return 7; } }');
    const result = await runProgram(compiled, engine, { programArguments: ['ignored by Main'] });
    assert.equal(result.output, 'started\n');
    assert.equal(result.exitCode, 7);
  });

  test(engine + ' top-level args are forwarded through the generated startup wrapper', async () => {
    const compiled = compileProgram('Console.WriteLine(args.Length); Console.WriteLine(args[0]);');
    assert.deepEqual(compiled.image.methods[compiled.image.entryPoint].parameters.map(parameter => parameter.type), ['string[]']);
    assert.equal((await runProgram(compiled, engine, { programArguments: ['top-level'] })).output, '1\ntop-level\n');
  });

  test(engine + ' module initializers run once before argv forwarding into Main', async () => {
    const compiled = compileProgram([
      { uri: 'First.cs', text: 'using System; class First { [System.Runtime.CompilerServices.ModuleInitializer] public static void Init() { Console.WriteLine("first"); } }' },
      { uri: 'Second.cs', text: 'using System; class Second { [System.Runtime.CompilerServices.ModuleInitializer] public static void Init() { Console.WriteLine("second"); } }' },
      { uri: 'Program.cs', text: 'using System; class Program { static void Main(string[] args) { Console.WriteLine(args[0]); } }' }
    ]);
    assert.equal((await runProgram(compiled, engine, { programArguments: ['main'] })).output, 'first\nsecond\nmain\n');
  });

  test(engine + ' async Main retains argv and its integer exit code across an await', async () => {
    const compiled = compileProgram(`using System.Threading.Tasks;
class Program {
  static async Task<int> Main(string[] args) {
    await Task.Delay(2);
    Console.WriteLine(args[0]);
    return args.Length;
  }
}`);
    const result = await runProgram(compiled, engine, { programArguments: ['after-await', 'second'], initialThreshold: 64 });
    assert.equal(result.output, 'after-await\n');
    assert.equal(result.exitCode, 2);
  });

  test(engine + ' argument arrays survive collection and caller mutation after construction', async () => {
    const compiled = compileProgram(argvProgram);
    const args = Array.from({ length: 100 }, (_, index) => 'argument-' + index);
    const vm = programVM(compiled, engine, { programArguments: args, initialThreshold: 64, virtualTime: true });
    args[0] = 'mutated';
    vm.heap.collect();
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.match(result.output, /^100\n\[argument-0\]/);
    assert.match(result.output, /\[argument-99\]\n$/);
    vm.stop();
  });
}

test('raw CIL methodToken invocations retain their numeric parameter contract', () => {
  const library = arithmeticLibrary();
  assert.equal(new CilVirtualMachine(library, { methodToken: 'Add', arguments: [19, 23] }).run().returnValue, 42);
  assert.equal(new CilVirtualMachine(library, { methodToken: 'Square', arguments: [9] }).run().returnValue, 81);
  assert.throws(() => new CilVirtualMachine(library, { methodToken: 0x06000001, arguments: [19] }), { code: 'METHOD_ARGUMENTS' });
  assert.throws(() => new CilVirtualMachine(library, { methodToken: 'Add', arguments: [19] }), /Selected method not found/);
  assert.throws(() => new CilVirtualMachine(library, { methodToken: 'Add', arguments: [1, 2], programArguments: ['argv'] }), {
    code: 'PROGRAM_ARGUMENTS_METHOD'
  });
});

test('independently authored CIL string-array entry receives argv without a compiler-specific payload', () => {
  const assembly = managedFixture({ methods: [{
    name: 'Main', parameters: ['string[]'], result: 'string',
    body: writer => writer.op('ldarg.0').op('ldc.i4.0').op('ldelem.ref').op('ret')
  }] });
  assert.equal(new CilVirtualMachine(assembly, { programArguments: ['ordinary-CIL'] }).run().returnValue, 'ordinary-CIL');
  assert.equal(new CilVirtualMachine(assembly, { arguments: [['raw-parameter']] }).run().returnValue, 'raw-parameter');
});
