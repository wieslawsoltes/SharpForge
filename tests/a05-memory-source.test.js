import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {Op, spanType, arrayType} from '@sharpforge/bytecode';
import {numericDifferential} from './support/numeric-differential.js';
import {memorySourceCases} from './a05-memory-source-fixtures.js';

for (const item of memorySourceCases) test('T03/T05 source memory: ' + item.name, () => {
  numericDifferential(item.source, item.output, {family: item.name});
});

for (const source of [
  'int[,] a=new int[2,3];Console.WriteLine(a[0]);',
  'int[,] a=new int[,]{{1,2},{3}};',
  'ReadOnlySpan<int> s=stackalloc int[1];s[0]=1;',
  'Span<int> s=stackalloc int[1];object boxed=s;',
  'Span<int> s=stackalloc int[1];Console.WriteLine(s[0,0]);',
]) test('T03/T05 rejects invalid memory expression: ' + source, () => {
  assert.equal(compile(source).success, false);
});

test('T03/T05 memory instruction IDs append to the versioned registry', () => {
  assert.equal(Op.ADDRESS, 30);
  assert.equal(Op.LDIND, 31);
  assert.equal(Op.STIND, 32);
  assert.equal(Op.NEWRECT, 33);
  assert.equal(Op.SPANDEFAULT, 44);
  assert.deepEqual(arrayType('int[,,]'), {element: 'int', rank: 3});
  assert.deepEqual(spanType('System.ReadOnlySpan`1<long>'), {element: 'long', readonly: true});
});

test('T03/T05 rectangular and Span source instructions survive canonical assembly reload', () => {
  const source = 'int[,] a=new int[1,1];a[0,0]=3;Span<int> s=stackalloc int[1];s[0]=a[0,0];';
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const image = loadAssembly(compiled.assembly);
  const codes = image.methods.flatMap(method => [...method.code].filter((_, index) => index % 3 === 0));
  for (const op of [Op.NEWRECT, Op.STRECT, Op.LDRECT, Op.STACKALLOC, Op.SPANSET]) assert(codes.includes(op));

});
