import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { isInUnsafeRegion, isRequiresUnsafe, safetyModifierOf } from '../packages/compiler/src/binder/memory-safety.js';

// PROVISIONAL (C# 15 preview): csharplang/proposals/unsafe-evolution.md revision 1. Roslyn 5.3 does not implement the
// updated memory safety rules, so nothing here is pinned against it: every expectation is the text of the pinned
// proposal (quoted in packages/compiler/src/binder/memory-safety.js).
const optedIn = { langVersion: 'preview', allowUnsafe: true, memorySafetyRules: true };
const analysisOf = (source, options = optedIn) => analyze([parse(new SourceText(source, 'Program.cs'), undefined, { languageVersion: 'preview' })], options);
const rulesOf = analysis => analysis.diagnostics.filter(d => d.code === 'SF2203');
/** The source text each rule is reported on, with the start of its message. */
const ruleText = d => d.message.replace(/^Preview rule: /, '').replace(/ \(provisional.*$/, '').replace(/: it can be .*$/, '').replace(/: '.*$/, '');
const reported = (source, options) => rulesOf(analysisOf(source, options)).map(d => `${source.slice(d.start, d.start + d.length)} | ${ruleText(d)}`);
const main = 'class Program { static void Main() { } }\n';

const library = `class Native
{
    public unsafe static int Read(int address) { return address; }
    public static int Plain(int value) { return value; }
    public unsafe Native(int size) { }
    public Native() { }
    public unsafe int Field;
    public unsafe int Property { get { return 1; } set { } }
    public int Mixed { get { return 1; } unsafe set { } }
    public safe int Marked() { return 1; }
}
`;
const use = body => `${library}class Program\n{\n    static void Main()\n    {\n${body}\n    }\n}\n`;

test('SF-A02-T92 requires-unsafe: `unsafe` on a member marks it, `safe` and no modifier do not', () => {
  const analysis = analysisOf(use('')),
    native = analysis.assembly.types.find(type => type.name === 'Native'),
    member = name => native.getMembers(name)[0];
  assert.deepEqual(rulesOf(analysis), []);
  assert.equal(isRequiresUnsafe(member('Read')), true);
  assert.equal(isRequiresUnsafe(member('Plain')), false);
  assert.equal(isRequiresUnsafe(member('Marked')), false);
  assert.equal(safetyModifierOf(member('Marked')), 'safe');
  assert.equal(safetyModifierOf(member('Plain')), null);
  assert.equal(isRequiresUnsafe(member('Field')), true);
  // "If the accessors don't have the unsafe/safe modifier, they inherit it from the property."
  assert.equal(isRequiresUnsafe(member('Property').getMethod), true);
  assert.equal(isRequiresUnsafe(member('Mixed')), false);
  assert.equal(isRequiresUnsafe(member('Mixed').getMethod), false);
  assert.equal(isRequiresUnsafe(member('Mixed').setMethod), true);
  assert.equal(isRequiresUnsafe(native), false, 'a type is never requires-unsafe');
});

test('SF-A02-T92 callers: using a requires-unsafe member outside an unsafe region is an error', () => {
  assert.deepEqual(reported(use('        int a = Native.Read(1);')), ["Native.Read(1) | 'Native.Read(int)' is requires-unsafe"]);
  assert.deepEqual(reported(use('        var n = new Native(4);')), ["new Native(4) | 'Native.Native(int)' is requires-unsafe"]);
  assert.deepEqual(reported(use('        var n = new Native(); int f = n.Field;')), ["n.Field | 'Native.Field' is requires-unsafe"]);
  assert.deepEqual(reported(use('        var n = new Native(); n.Field = 2;')), ["n.Field | 'Native.Field' is requires-unsafe"]);
  assert.deepEqual(reported(use('        var n = new Native(); int p = n.Property;')), ["n.Property | 'Native.Property' is requires-unsafe"]);
  // Members that are not requires-unsafe need nothing.
  assert.deepEqual(reported(use('        var n = new Native(); int v = Native.Plain(1) + n.Marked() + n.Mixed;')), []);
  const [rule] = rulesOf(analysisOf(use('        int a = Native.Read(1);')));
  assert.equal(rule.severity, 'error');
  assert.match(rule.message, /it can be used only in an unsafe context/);
  assert.match(rule.message, /unsafe-evolution\.md revision 1/);
});

test('SF-A02-T92 unsafe regions: a block, an unsafe expression and the initializer of an unsafe constructor', () => {
  assert.deepEqual(reported(use('        unsafe { int a = Native.Read(1); var n = new Native(4); n.Field = a; }')), []);
  assert.deepEqual(reported(use('        int a = unsafe(Native.Read(1)) + 1;')), []);
  // "The unsafe context established by an unsafe_expression does not extend beyond its closing parenthesis."
  assert.deepEqual(reported(use('        int a = unsafe(Native.Read(1)) + Native.Read(2);')), ["Native.Read(2) | 'Native.Read(int)' is requires-unsafe"]);
  // "`unsafe` on a member ... does not introduce an unsafe context".
  const member = `${library}class Wrapper
{
    public unsafe int Outer() { return Native.Read(1); }
    public unsafe int Inner() { unsafe { return Native.Read(1); } }
}
${main}`;
  assert.deepEqual(reported(member), ["Native.Read(1) | 'Native.Read(int)' is requires-unsafe"]);
  // "`unsafe` on a constructor introduces an unsafe context inside its initializer".
  const constructors = `${library}class Derived : Native
{
    public unsafe Derived() : base(1) { }
    public Derived(int size) : base(size) { }
}
${main}`;
  assert.deepEqual(reported(constructors), [": base(size) | 'Native.Native(int)' is requires-unsafe"]);
});

test('SF-A02-T92 local functions and delegates', () => {
  // "To mark a local function as requires-unsafe, it must manually be marked as `unsafe`"; one declared inside an
  // unsafe block is still in an unsafe context.
  const locals = use(`        unsafe int Local() { return 1; }
        int Safe() { return 2; }
        int a = Local() + Safe();
        unsafe { int b = Local(); int Nested() { return Native.Read(1); } }`);
  assert.deepEqual(reported(locals), ["Local() | 'Local()' is requires-unsafe"]);
  // "It is a memory safety error to convert a requires-unsafe member to a delegate type outside the unsafe context."
  const delegates = use(`        System.Func<int, int> read = Native.Read;
        System.Func<int, int> plain = Native.Plain;
        unsafe { System.Func<int, int> inside = Native.Read; }`);
  assert.deepEqual(reported(delegates), ["Native.Read | 'Native.Read(int)' is requires-unsafe"]);
  assert.match(rulesOf(analysisOf(delegates))[0].message, /converted to a delegate type only in an unsafe context/);
});

test('SF-A02-T92 declarations: unsafe without a meaning, added unsafe, extern, explicit layout', () => {
  const declarations = `using System.Runtime.InteropServices;
unsafe class Holder { }
unsafe delegate void Callback();
class Members
{
    unsafe static Members() { }
    unsafe ~Members() { }
    [DllImport("native")] static extern int Unmarked(int value);
    [DllImport("native")] static extern unsafe int Dangerous(int value);
    [DllImport("native")] static extern safe int Reviewed(int value);
}
interface IReader { int Read(); unsafe int Raw(); }
class Base { public virtual int Get() { return 0; } public unsafe virtual int Raw() { return 0; } }
class Derived : Base, IReader
{
    public unsafe override int Get() { return 1; }
    public unsafe override int Raw() { return 1; }
    public unsafe int Read() { return 2; }
}
[StructLayout(LayoutKind.Explicit)]
class Overlay
{
    [FieldOffset(0)] public int Unmarked;
    [FieldOffset(0)] public safe int Reviewed;
    [FieldOffset(4)] public unsafe int Raw;
    public static int Shared;
}
[StructLayout(LayoutKind.Sequential)]
class Sequential { public int Any; }
${main}`;
  assert.deepEqual(reported(declarations), [
    "Holder | 'unsafe' on a type declaration has no meaning under the updated memory safety rules",
    "Callback | 'unsafe' on a delegate has no meaning under the updated memory safety rules",
    "Members | 'unsafe' on a static constructor has no meaning under the updated memory safety rules",
    "Members | 'unsafe' on a destructor has no meaning under the updated memory safety rules",
    "Unmarked | the extern method 'Members.Unmarked(int)' must be marked 'safe' or 'unsafe'",
    "Get | 'Derived.Get()' cannot add 'unsafe'",
    "Read | 'Derived.Read()' cannot add 'unsafe'",
    "Unmarked | 'Overlay.Unmarked' is in a type with explicit layout and must be marked 'safe' or 'unsafe'",
  ]);
});

test('SF-A02-T92 opt-in: without the option, or below preview, none of the rules applies', () => {
  const source = use('        int a = Native.Read(1);').replace('    public safe int Marked() { return 1; }\n', '');
  assert.equal(rulesOf(analysisOf(source)).length, 1);
  assert.deepEqual(rulesOf(analysisOf(source, { langVersion: 'preview', allowUnsafe: true })), [], 'not opted in');
  assert.deepEqual(rulesOf(analysisOf(source, { langVersion: 'preview', allowUnsafe: true, memorySafetyRules: false })), []);
  assert.deepEqual(rulesOf(analysisOf(source, { langVersion: '14', allowUnsafe: true, memorySafetyRules: true })), [], 'not preview');
});

test('SF-A02-T92 isInUnsafeRegion follows the syntax, not the member modifier', () => {
  const file = parse(new SourceText('class C { unsafe void M() { int a = 1; unsafe { int b = 2; } int c = unsafe(3); } }', 'C.cs'), undefined, {
    languageVersion: 'preview',
  });
  const literals = [];
  const visit = node => {
    if (node.kind === 'NumericLiteralExpression') literals.push(node);
    for (const child of node.childNodes()) visit(child);
  };
  visit(file.syntax);
  assert.deepEqual(literals.map(isInUnsafeRegion), [false, true, true]);
});

test('SF-A02-T92 compile(): an opted-in program that uses a requires-unsafe member in an unsafe block runs', () => {
  const source = `using System;
class Native { public unsafe static int Twice(int value) { return value * 2; } }
class Program
{
    static void Main()
    {
        unsafe { Console.WriteLine(Native.Twice(21)); }
        Console.WriteLine(unsafe(Native.Twice(4)));
    }
}
`;
  const ok = compile(source, optedIn);
  assert.deepEqual(ok.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message), []);
  const rejected = compile(source.replace('unsafe { Console.WriteLine(Native.Twice(21)); }', 'Console.WriteLine(Native.Twice(21));'), optedIn);
  assert.equal(rejected.success, false);
  assert.equal(rejected.image, null);
  assert.deepEqual(rejected.diagnostics.filter(d => d.code === 'SF2203').length, 1);
});
