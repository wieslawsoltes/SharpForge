// Partial methods and properties (SF-A02-T55, SF-A02-T83) and the finalizer policy, against Roslyn and .NET.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { testPinnedFeature } from './support/pinned-feature.js';
import { linesOf } from './support/semantic-codegen.js';

testPinnedFeature('SF-A02-T55', 'member-partial', { outputs: 4, diagnostics: 7 });

const analysisOf = source => analyze([parse(new SourceText(source, 'a.cs'))]);
const typeNamed = (analysis, name) => analysis.assembly.types.find(type => type.name === name);

test('SF-A02-T55 a partial method is one symbol: the implementing part, linked to its defining part', () => {
  const analysis = analysisOf(`
    partial class A { public partial int M(int x = 4); partial void Never(); }
    partial class A { public partial int M(int x) { return x; } }
    class P { static void Main() { } }`);
  assert.deepEqual(
    analysis.diagnostics.filter(d => d.severity === 'error').map(d => d.code),
    [],
  );
  const [method] = typeNamed(analysis, 'A').getMembers('M');
  assert.equal(typeNamed(analysis, 'A').getMembers('M').length, 1);
  assert.equal(method.hasBody, true);
  assert.equal(method.partialDefinitionPart.hasBody, false);
  assert.equal(method.parameters[0].isOptional, true, 'the default of the defining part applies');
  const [never] = typeNamed(analysis, 'A').getMembers('Never');
  assert.equal(never.isUnimplementedPartial, true);
});

test('SF-A02-T83 a partial property keeps the implementing part and no backing field', () => {
  const analysis = analysisOf(`
    partial class A { public partial int Value { get; set; } }
    partial class A { int v; public partial int Value { get => v; set => v = value; } }
    class P { static void Main() { } }`);
  const members = typeNamed(analysis, 'A').getMembers();
  assert.deepEqual(
    members.filter(member => member.name.includes('Value')).map(member => [member.name, !!member.isAutoProperty]),
    [['Value', false]],
  );
});

test('SF-A02-T55 an unimplemented partial method is not in the image and its arguments are not evaluated', () => {
  const source = `
    using System;
    partial class A {
      partial void Trace(int value);
      static int Count() { Console.WriteLine("counted"); return 1; }
      public void Run() { Trace(Count()); Console.WriteLine("ran"); }
    }
    class Program { static void Main() { new A().Run(); } }`;
  assert.deepEqual(linesOf(source), ['ran']);
  const image = compile(source).image;
  assert.equal(
    image.methods.some(method => method.name === 'Trace'),
    false,
  );
});

test('finalizer policy: the finalizer is compiled, checked and never called', () => {
  const source = `
    using System;
    class R { ~R() { Console.WriteLine("finalized"); } }
    class Program { static void Main() { new R(); Console.WriteLine("end"); } }`;
  assert.deepEqual(linesOf(source), ['end']);
  assert.equal(
    compile(source).image.methods.some(method => method.name === 'Finalize'),
    true,
  );
});
