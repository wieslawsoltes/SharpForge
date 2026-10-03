/**
 * SF-A02-T48: destructors and extern members. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/special-members.js; these tests cover the rule function itself and what
 * code generation does with members that have no body to run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { checkSpecialMembers } from '../packages/compiler/src/binder/special-members.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const analysisOf = source => analyze([parse(new SourceText(source, 'a.cs'))]);
const rulesOf = (source, typeName) => {
  const type = analysisOf(source).assembly.types.find(candidate => candidate.name === typeName);
  return checkSpecialMembers(type).map(found => found.code);
};

test('SF-A02-T48 destructor rules: one per class, named like it, without modifiers', () => {
  assert.deepEqual(rulesOf('class A { ~A() { } }', 'A'), []);
  assert.deepEqual(rulesOf('class A { ~A() { } ~A() { } ~A() { } }', 'A'), ['CS0111', 'CS0111']);
  assert.deepEqual(rulesOf('class A { private ~B() { } }', 'A'), ['CS0106', 'CS0574']);
  assert.deepEqual(rulesOf('struct S { ~S() { } }', 'S'), ['CS0575']);
  assert.deepEqual(rulesOf('class A { unsafe extern ~A(); }', 'A'), ['CS0626']);
});

test('SF-A02-T48 extern rules read the bound attributes of the member', () => {
  const source = body => `using System; using System.Runtime.InteropServices; abstract class N { ${body} }`;
  assert.deepEqual(rulesOf(source('[DllImport("a")] static extern void M();'), 'N'), []);
  assert.deepEqual(rulesOf(source('static extern void M();'), 'N'), ['CS0626']);
  assert.deepEqual(rulesOf(source('[Obsolete] static extern void M();'), 'N'), []);
  assert.deepEqual(rulesOf(source('extern N();'), 'N'), ['CS0824']);
  assert.deepEqual(rulesOf(source('static extern void M() { }'), 'N'), ['CS0179']);
  assert.deepEqual(rulesOf(source('public abstract extern void M();'), 'N'), ['CS0180']);
  assert.deepEqual(rulesOf(source('[DllImport("a")] extern void M();'), 'N'), ['CS0601']);
  assert.deepEqual(rulesOf(source('[DllImport("a")] static void M() { }'), 'N'), ['CS0601']);
  // The attribute is found by the class it binds to: an alias works, a user class named DllImport does not count.
  const alias = 'using System.Runtime.InteropServices; using Import = System.Runtime.InteropServices.DllImportAttribute;';
  assert.deepEqual(rulesOf(`${alias} class N { [Import("a")] void M() { } }`, 'N'), ['CS0601']);
  const own = 'using System; class DllImportAttribute : Attribute { public DllImportAttribute(string name) { } }';
  assert.deepEqual(rulesOf(`${own} class N { [DllImport("a")] void M() { } }`, 'N'), []);
});

test('SF-A02-T48 an extern method that is never called does not stop the program; a call is not executable', () => {
  const program = main => `using System;
using System.Runtime.InteropServices;
class Native { [DllImport("kernel32")] public static extern int Beep(int frequency, int duration); }
class Program { static void Main() { ${main} Console.WriteLine("done"); } }`;
  assert.deepEqual(linesOf(program('')), ['done']);
  const reported = notExecutable(program('Native.Beep(440, 10);'));
  assert.match(reported.message, /call to the extern method 'Native\.Beep\(int, int\)' \(the runtime has no platform invoke\)/);
});

test('SF-A02-T48 a destructor is compiled and never called', () => {
  const source = `using System;
class R { public static int Finalized; ~R() { Finalized++; } }
class Program { static void Main() { new R(); new R(); Console.WriteLine(R.Finalized); } }`;
  assert.deepEqual(linesOf(source), ['0']);
  assert.deepEqual(compile(source).diagnostics.filter(d => d.severity === 'error'), []);
});
