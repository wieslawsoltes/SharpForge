import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '../../../packages/compiler/src/index.js';
import {
  VirtualMachine,
  CilVirtualMachine,
  ManagedFault,
} from '../../../packages/runtime/src/index.js';
import {
  Op,
  Builtins,
  verifyImage,
} from '../../../packages/bytecode/src/index.js';
import { managedFixture } from '../../managed-fixtures.js';

// Defensive, fixed repository fixtures only. Compiler/load rejection is explicitly
// distinguished from a managed execution fault; neither is CLR/native qualification.
function compiled(source) {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function guardHost(action) {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const marker = Object.getOwnPropertyDescriptor(
    globalThis,
    '__sfSandboxProbe',
  );
  try {
    return action();
  } finally {
    assert.deepEqual(
      Object.getOwnPropertyDescriptors(Object.prototype),
      before,
    );
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(globalThis, '__sfSandboxProbe'),
      marker,
    );
  }
}
for (const engine of ['source', 'cil']) {
  test(`sandbox ${engine}: ordinary managed names do not address host prototypes`, () =>
    guardHost(() => {
      const result = compiled(
        'class P { public int constructor; public int __proto__; static void Main(){var p=new P();p.constructor=20;p.__proto__=22;Console.WriteLine(p.constructor+p.__proto__);} }',
      );
      const vm =
        engine === 'source'
          ? new VirtualMachine(result.image)
          : new CilVirtualMachine(result.assembly);
      try {
        const actual = vm.run();
        assert.equal(actual.state, 'terminated');
        assert.equal(actual.output, '42\n');
      } finally {
        vm.stop();
      }
    }));
}
for (const source of [
  'object value = new object(); Console.WriteLine(value.constructor);',
  'object value = new object(); Console.WriteLine(value.__proto__);',
  'Console.WriteLine(typeof(object).GetMethod("ToString"));',
  'Console.WriteLine(System.IO.File.ReadAllText("sandbox-probe"));',
  'Console.WriteLine(System.Environment.GetEnvironmentVariable("sandbox-probe"));',
]) {
  test('sandbox source boundary rejects unlisted host access: ' + source, () =>
    guardHost(() => {
      const result = compileToIL(source);
      assert.equal(result.success, false);
      assert(result.diagnostics.some((row) => row.severity === 'error'));
      assert.equal(!!result.assembly, false);
    }),
  );
}
for (const id of [-1, Builtins.length, 0x7fffffff]) {
  test(`sandbox source loader rejects forged builtin id ${id}`, () =>
    guardHost(() => {
      const image = structuredClone(compiled('Console.WriteLine(42);').image);
      image.methods[image.entryPoint].code = Int32Array.from([
        Op.BUILTIN,
        id,
        0,
        Op.RET,
        0,
        0,
      ]);
      assert(
        verifyImage(image).some((message) => /Invalid intrinsic/.test(message)),
      );
      assert.throws(
        () => new VirtualMachine(image),
        /Bytecode verification failed/,
      );
    }));
}
for (const name of ['constructor', '__proto__', 'eval', 'GetHostObject']) {
  test(`sandbox crafted CIL rejects unlisted System.Object.${name}`, () =>
    guardHost(() => {
      const bytes = managedFixture({
        methods: [
          {
            name: 'Main',
            result: 'object',
            body: (writer, context) =>
              writer
                .op('call', context.member('System.Object', name, 'object'))
                .op('ret'),
          },
        ],
      });
      assert.throws(
        () => new CilVirtualMachine(bytes),
        /verification|unsupported|intrinsic|not supported/i,
      );
    }));
}
test('sandbox source execution rejects a forged managed handle with a managed fault', () =>
  guardHost(() => {
    const image = structuredClone(compiled('Console.WriteLine(42);').image);
    image.constants.push({ h: 2147483647, g: 1 });
    image.methods[image.entryPoint].code = Int32Array.from([
      Op.CONST,
      image.constants.length - 1,
      0,
      Op.LDFLD,
      0,
      0,
      Op.RET,
      0,
      0,
    ]);
    const vm = new VirtualMachine(image);
    try {
      const actual = vm.run();
      assert.equal(actual.state, 'faulted');
      assert(actual.fault instanceof ManagedFault);
      assert.equal(actual.fault.name, 'InvalidReferenceException');
      assert.equal(actual.output, '');
    } finally {
      vm.stop();
    }
  }));
test('sandbox crafted CIL cannot use a null receiver to obtain a host constructor', () =>
  guardHost(() => {
    const bytes = managedFixture({
      methods: [
        {
          name: 'Main',
          result: 'System.Type',
          body: (writer, context) =>
            writer
              .op('ldnull')
              .op(
                'callvirt',
                context.member(
                  'System.Object',
                  'GetType',
                  'System.Type',
                  [],
                  false,
                ),
              )
              .op('ret'),
        },
      ],
    });
    const vm = new CilVirtualMachine(bytes);
    try {
      const actual = vm.run();
      assert.equal(actual.state, 'faulted');
      assert(actual.fault instanceof ManagedFault);
      assert.equal(actual.fault.name, 'NullReferenceException');
      assert.equal(actual.output, '');
    } finally {
      vm.stop();
    }
  }));
