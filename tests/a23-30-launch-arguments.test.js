import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {emitAssembly, loadAssembly} from '@sharpforge/cil';
import {Op, verifyImage} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine, withSourceLaunchArguments} from '@sharpforge/runtime';

for (const backend of ['source', 'cil', 'source-from-cil']) {
  test(`A23 T30 ${backend} launch args preserve static initialization and async Main completion`, async () => {
    const compiled = compile(`using System; using System.Threading.Tasks;
      class Entry {
        static string prefix = "initialized";
        static async Task<int> Main(string[] args) {
          await Task.Delay(1);
          Console.WriteLine(prefix + ":" + args.Length + ":" + args[0] + ":" + args[1]);
          return args.Length;
        }
      }`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const original = compiled.image.methods[compiled.image.entryPoint].code.slice();
    const input = backend === 'source-from-cil' ? loadAssembly(emitAssembly(compiled.image)) : compiled.image;
    const image = withSourceLaunchArguments(input, ['quoted argument', 'second']);
    assert.deepEqual(verifyImage(image), []);
    assert.deepEqual(compiled.image.methods[compiled.image.entryPoint].code, original);
    const vm = backend === 'cil' ? new CilVirtualMachine(emitAssembly(image)) : new VirtualMachine(image);
    const result = await vm.runAsync();
    assert.equal(result.fault, null, result.fault?.message);
    assert.equal(result.output, 'initialized:2:quoted argument:second\n');
    assert.equal(result.exitCode, 2);
  });
}

test('A23 T30 rejects malformed argv and preserves parameterless Main', () => {
  const compiled = compile('class Entry { static void Main() { } }');
  assert.equal(withSourceLaunchArguments(compiled.image, ['ignored']), compiled.image);
  assert.throws(() => withSourceLaunchArguments(compiled.image, ['bad\0argument']), /Invalid managed launch/);
  assert.throws(() => withSourceLaunchArguments({}, ['a']), /compiler-generated/);
});

test('A23 T30 keeps the legacy empty-array startup overlay compatible with current runtime admission', () => {
  const compiled = compile(`class Entry { static void Main(string[] args) {
    System.Console.WriteLine(args.Length); System.Console.WriteLine(args[0]);
  } }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const source = compiled.image;
  const startup = source.methods[source.entryPoint];
  const code = [...startup.code];
  const main = source.methods.find(method => method.name === 'Main');
  let call = -1;
  for (let offset = 0; offset < code.length; offset += 3) {
    if (code[offset] === Op.CALL && code[offset + 1] === main.id) call = offset;
  }
  assert.ok(call >= 3);
  assert.equal(code[call - 3], Op.LDLOC);
  const constants = [...source.constants, 0, 'string'];
  code.splice(call - 3, 3, Op.CONST, constants.length - 2, 0, Op.NEWARR, constants.length - 1, 0);
  const methods = [...source.methods];
  methods[startup.id] = {...startup, parameters: [], code: Int32Array.from(code)};
  const sequencePoints = source.sequencePoints.map(point => point.methodId === startup.id && point.offset >= call / 3
    ? {...point, offset: point.offset + 1} : point);
  const legacy = {...source, constants, methods, sequencePoints};
  assert.deepEqual(verifyImage(legacy), []);
  const overlay = withSourceLaunchArguments(legacy, ['legacy']);
  assert.deepEqual(verifyImage(overlay), []);
  assert.equal(new VirtualMachine(overlay).run().output, '1\nlegacy\n');
  assert.equal(new CilVirtualMachine(emitAssembly(overlay)).run().output, '1\nlegacy\n');
});
