import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {Binary, Op} from '@sharpforge/bytecode';
import {numericDifferential} from './support/numeric-differential.js';

for (const nativeIntBits of [32, 64]) test(`T01.9 unsigned shifts and checked contexts at ABI${nativeIntBits}`, () => {
  const source = 'int x=-1;long wide=-1L;nint native=(nint)(-1);byte small=255;' +
    'Console.WriteLine(x>>>1);Console.WriteLine(wide>>>65);Console.WriteLine((long)(native>>>1));' +
    'x>>>=1;wide>>>=65;small>>>=1;Console.WriteLine(x);Console.WriteLine(wide);Console.WriteLine(small);' +
    'int amount=300;try{Console.WriteLine(checked((byte)amount));}catch(Exception error){Console.WriteLine(error.GetType().Name);}' +
    'long maximum=long.MaxValue;try{Console.WriteLine(checked(maximum+1L));}' +
    'catch(Exception error){Console.WriteLine(error.GetType().Name);}';
  const native = nativeIntBits === 64 ? '9223372036854775807' : '2147483647';
  numericDifferential(source, `2147483647\n9223372036854775807\n${native}\n2147483647\n9223372036854775807\n127\n` +
    'OverflowException\nOverflowException\n', {family: 'checked shifts', nativeIntBits});
});

test('T01.9 unsigned shift has an appended stable operator id and survives canonical reload', () => {
  assert.equal(Binary['>>'], 15);
  assert.equal(Binary['>>>'], 16);
  const compiled = compileToIL('uint value=4294967295U;Console.WriteLine(value>>>1);');
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const image = loadAssembly(compiled.assembly);
  assert(image.methods.some(method => [...method.code].some((opcode, index) =>
    index % 3 === 0 && opcode === Op.BINARY && method.code[index + 1] === Binary['>>>'])));
});

for (const source of ['double x=1;Console.WriteLine(x>>>1);', 'int x=1;Console.WriteLine(x>>>1L);']) {
  test('T01.9 rejects invalid shift operands: ' + source, () => assert.equal(compile(source).success, false));
}

test('T01.9 unsigned right shift enforces the C# 11 feature boundary', () => {
  const result = compile('int value=-1;Console.WriteLine(value>>>1);', {langVersion: '10'});
  assert.equal(result.success, false);
  assert(result.diagnostics.some(diagnostic => diagnostic.code === 'CS9058'));
});
