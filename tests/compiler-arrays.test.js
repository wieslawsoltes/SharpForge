/**
 * SF-A02-T45: arrays. The Roslyn-pinned cases are in packages/compiler/test/differential/fixtures/arrays.js; these
 * tests cover the shape rule on its own, the image a rank-n array is lowered to, the faults it raises and the
 * constructs that are reported instead of lowered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { initializerShapeProblems } from '../packages/compiler/src/binder/arrays.js';
import { linesOf, notExecutable, runOnBothBackEnds } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program { static void Main() { ${body} } }\n`;

function initializerOf(text) {
  const file = parse(new SourceText(`class C { int[,,] f = ${text}; }`, 'a.cs'));
  let found = null;
  const visit = node => {
    if (!found && node.kind === 'ArrayInitializerExpression') found = node;
    for (const child of node.childNodes()) if (!found) visit(child);
  };
  visit(file.syntax);
  return found;
}

test('SF-A02-T45 an initializer of a rank-n array is rectangular', () => {
  const problems = (text, rank, lengths) => initializerShapeProblems(initializerOf(text), rank, lengths).map(p => `${p.code}:${p.args[0]}`);
  assert.deepEqual(problems('{ { 1, 2 }, { 3, 4 } }', 2), []);
  assert.deepEqual(problems('{ { 1, 2 }, { 3 }, { 4, 5, 6 } }', 2), ['CS0847:2', 'CS0847:2']);
  assert.deepEqual(problems('{ { { 1 }, { 2 } }, { { 3 }, { 4, 5 } } }', 3), ['CS0847:1']);
  assert.deepEqual(problems('{ { 1, 2 }, { 3, 4 } }', 2, [3, null]), ['CS0847:3']);
  assert.deepEqual(problems('{ { 1, 2 }, { 3, 4 } }', 2, [2, 3]), ['CS0847:3', 'CS0847:3']);
  // Rank 1: nested braces are another rule (CS0623); only the outer length is compared.
  assert.deepEqual(problems('{ 1, 2, 3 }', 1, [2]), ['CS0847:2']);
  assert.deepEqual(problems('{ }', 2), []);
});

test('SF-A02-T45 a rank-n array is an object over one flat array with a length per dimension', () => {
  const { image, output } = runOnBothBackEnds(program('int[,] m = new int[2, 3]; double[,,] d = new double[1, 1, 1]; Console.WriteLine(m.Length + d.Length);'));
  assert.equal(output, '7\n');
  const shape = name => image.types.find(type => type.name === name).fields.map(field => `${field.name}:${field.type}`);
  assert.deepEqual(shape('$Array2(int)'), ['Items:int[]', 'Length0:int', 'Length1:int']);
  assert.deepEqual(shape('$Array3(double)'), ['Items:double[]', 'Length0:int', 'Length1:int', 'Length2:int']);
});

test('SF-A02-T45 an index outside its own dimension faults even when the flat offset would be in range', () => {
  const faultOf = body => {
    const result = compile(program(`int[,] m = new int[2, 3]; ${body}`));
    assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
    return new VirtualMachine(result.image).run().fault?.name;
  };
  assert.equal(faultOf('m[0, 3] = 1;'), 'IndexOutOfRangeException');
  assert.equal(faultOf('Console.WriteLine(m[1, -1]);'), 'IndexOutOfRangeException');
  assert.equal(faultOf('m[2, 0]++;'), 'IndexOutOfRangeException');
  assert.equal(faultOf('m[1, 2] += 4; Console.WriteLine(m[1, 2]);'), undefined);
});

test('SF-A02-T45 Rank is the rank, not the length', () => {
  assert.deepEqual(linesOf(program('int[] a = new int[5]; int[][] j = new int[4][]; Console.WriteLine(a.Rank + " " + j.Rank);')), ['1 1']);
});

test('SF-A02-T45 what is not lowered is reported, never miscompiled', () => {
  const covariant = notExecutable(program('object[] o = new string[1]; o[0] = "a";'));
  assert.match(covariant.message, /converting 'string\[\]' to 'object\[\]'/);
  const dimension = notExecutable(program('int[,] m = new int[1, 1]; int d = 1; Console.WriteLine(m.GetLength(d));'));
  assert.match(dimension.message, /'GetLength' with a dimension that is not a constant within the rank/);
  const outside = notExecutable(program('int[,] m = new int[1, 1]; Console.WriteLine(m.GetLength(2));'));
  assert.match(outside.message, /not a constant within the rank/);
});
