import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, runOnBothBackEnds, notExecutable } from './support/semantic-codegen.js';
import { testPinnedFeature } from './support/pinned-feature.js';

// SF-A02-T02.6: user-defined generics run as one image class or method per closed construction (monomorphization).
// The pinned fixtures print on both back ends what the same programs print on .NET (Roslyn 5.3.0, .NET 10.0.5).
testPinnedFeature('SF-A02-T02.6', 'generic-lowering', { outputs: 9, diagnostics: 5 });
testPinnedFeature('SF-A02-T02.6', 'generic-interactions', { outputs: 3, diagnostics: 0 });

const program = (declarations, body) => `using System;\n${declarations}\nclass Program { static void Main() { ${body} } }\n`;
const box = 'class Box<T> { public T Value; public static int Count; public Box(T value) { Value = value; Count++; } public T Get() { return Value; } }';

/** Characters the runtime's type-name parser gives a meaning to; a synthesized name must not contain them. */
const parsedCharacters = /[<>,()[\]?*&`\s]/;

test('A02-T02.6 names: constructions get stable names without characters the type-name parser reads', () => {
  const source = program(
    `${box}
     class Pair<A, B> { public A First; public B Second; }
     class Outer<T> { public class Inner<U> { public T Left; public U Right; } }
     static class Util { public static T Id<T>(T x) { return x; } }`,
    `var a = new Box<int>(1); var b = new Box<string>("s"); var c = new Box<Box<int>>(a); var d = new Box<int[]>(new int[1]);
     var p = new Pair<string, Box<int>>(); var i = new Outer<int>.Inner<string>(); var t = new Box<(int, string)>((1, "x"));
     Console.WriteLine(Util.Id(a.Get()) + Util.Id(b.Get()) + c.Get().Get() + d.Get().Length + i.Left + t.Get().Item2);`,
  );
  const { image, output } = runOnBothBackEnds(source);
  assert.equal(output, '1s110x\n');
  const names = image.types.map(type => type.name);
  for (const expected of ['Box{int}', 'Box{string}', 'Box{Box{int}}', 'Box{Array{int}}', 'Pair{string;Box{int}}', 'Outer{int}.Inner{string}']) {
    assert.ok(names.includes(expected), `${expected} in ${names.join(' ')}`);
  }
  const constructions = names.filter(name => name.includes('{'));
  assert.equal(new Set(constructions).size, constructions.length, 'one image class per construction');
  for (const name of constructions.filter(n => !n.startsWith('<'))) assert.doesNotMatch(name, parsedCharacters, name);
  const methods = image.methods.map(method => method.qualifiedName);
  assert.ok(methods.includes('Util.Id{int}') && methods.includes('Util.Id{string}'), methods.join(' '));
  assert.ok(!names.includes('Box') && !names.includes('Box<T>'), 'the generic definition itself is not an image class');
  // The same program compiles to the same names again: nothing depends on symbol identity or iteration order.
  assert.deepEqual(
    compile(source).image.types.map(type => type.name),
    names,
  );
});

test('A02-T02.6 only the constructions and methods a program uses are generated', () => {
  const { image } = runOnBothBackEnds(
    program(
      `${box}
       class Unused<T> { public T Value; public Unused<Unused<T>> Grow() { return null; } }
       static class Util { public static T Id<T>(T x) { return x; } public static T Never<T>(T x) { return x; } }`,
      'Console.WriteLine(Util.Id(new Box<int>(2).Value));',
    ),
  );
  const names = image.types.map(type => type.name),
    methods = image.methods.map(method => method.qualifiedName);
  assert.deepEqual(
    names.filter(name => /Box|Unused/.test(name)),
    ['Box{int}'],
  );
  assert.ok(methods.includes('Util.Id{int}'));
  assert.ok(!methods.some(name => name.includes('Never')), 'a generic method that is never constructed has no image method');
  assert.ok(!methods.includes('Box{int}.Get'), 'a method of a construction that is never called is not declared');
});

test('A02-T02.6 a signature that mentions a larger construction does not instantiate without end', () => {
  const lines = linesOf(
    program(
      'class Box<T> { public T Value; public Box(T value) { Value = value; } public Box<Box<T>> Wrap() { return new Box<Box<T>>(this); } }',
      'Console.WriteLine(new Box<int>(7).Wrap().Wrap().Value.Value.Value);',
    ),
  );
  assert.deepEqual(lines, ['7']);
});

test('A02-T02.6 statics and type initializers are per construction', () => {
  const lines = linesOf(
    program(
      `class Registry<T> {
         public static int Count;
         public static string Tag = "t" + Count;
         static Registry() { Count = 10; }
         public static int Next() { Count++; return Count; }
       }`,
      `Console.WriteLine(Registry<int>.Next() + " " + Registry<int>.Next() + " " + Registry<string>.Next());
       Registry<bool>.Count = 5;
       Console.WriteLine(Registry<int>.Count + " " + Registry<string>.Count + " " + Registry<bool>.Count + " " + Registry<int>.Tag);`,
    ),
  );
  assert.deepEqual(lines, ['11 12 11', '12 11 5 t0']);
});

test('A02-T02.6 default(T), new T() and constrained calls take their meaning from the closed type', () => {
  const lines = linesOf(
    program(
      `interface INamed { string Name { get; } int Rank(); }
       class Cat : INamed { public string Name { get { return "cat"; } } public int Rank() { return 2; } }
       class Dog : INamed { public string Name => "dog"; int INamed.Rank() { return 9; } }
       static class Util {
         public static T Zero<T>() { return default(T); }
         public static T Make<T>() where T : new() { return new T(); }
         public static string Describe<T>(T value) where T : INamed { return value.Name + value.Rank(); }
       }`,
      `Console.WriteLine(Util.Zero<int>() + " " + Util.Zero<bool>() + " " + (Util.Zero<string>() == null) + " " + (Util.Zero<Cat>() == null));
       Console.WriteLine(Util.Describe(Util.Make<Cat>()) + Util.Describe(new Dog()) + Util.Make<int>() + Util.Make<double>());`,
    ),
  );
  assert.deepEqual(lines, ['0 False True True', 'cat2dog900']);
});

test('A02-T02.6 what needs the run-time type or dispatch is reported as SF2200, never miscompiled', () => {
  const shape = 'interface IShape { int Area() { return 9; } } class Blob : IShape { }';
  const cases = [
    // Dispatch and run-time type arguments.
    [program(`${shape} static class U { public static int A<T>(T s) where T : IShape { return s.Area(); } }`, 'U.A(new Blob());'), /interface dispatch/],
    [program('class B { public virtual T Id<T>(T x) { return x; } }', 'new B().Id(3);'), /virtual dispatch/],
    [program('class Base<T> { public T V; } class D : Base<int> { }', 'new D();'), /class inheritance/],
    [program('static class U { public static bool Is<T>(object o) { return o is T; } }', 'U.Is<string>("s");'), /runtime type check/],
    [program('static class U { public static T As<T>(object o) { return (T)o; } }', 'U.As<string>("s");'), /runtime type check/],
    [program('record Wrapper<T>(T Value);', 'var w = new Wrapper<int>(1);'), /generic records/],
    // Polymorphic recursion has no finite set of constructions.
    [program(`${box} static class U { public static int D<T>(T x, int n) { return D(new Box<T>(x), n - 1); } }`, "U.D(1, 2);"), /does not terminate/],
  ];
  for (const [source, expected] of cases) assert.match(notExecutable(source).message, expected, source);
});

test('A02-T02.6 a generic class or method that is never constructed does not make a program unexecutable', () => {
  const lines = linesOf(
    program(
      `class Unused<T> { public T Value; public string Name() { return typeof(T).Name; } }
       static class U { public static bool Is<T>(object o) { return o is T; } }`,
      'Console.WriteLine("ok");',
    ),
  );
  assert.deepEqual(lines, ['ok']);
});

test('A02-T02.6 a task over a reference result shares the registry task over object; other framework generics do not', () => {
  const animal = 'class Animal { public string Name = "a"; }';
  const asyncProgram = (declarations, body) =>
    `using System;\nusing System.Threading.Tasks;\n${declarations}\nclass Program { ${body} }\n`;
  const shared = compile(
    asyncProgram(animal, 'static async Task<Animal> Make() { await Task.Yield(); return new Animal(); } static async Task Main() { await Make(); }'),
  );
  assert.ok(shared.image, 'Task<Animal> is executable');
  const make = shared.image.methods.find(method => method.qualifiedName === 'Program.Make');
  assert.equal(make.returnType, 'System.Threading.Tasks.Task`1<object>');
  // The run-time type of such a task is Task<object>, so it must not reach ToString() either.
  const printed = asyncProgram(
    animal,
    'static async Task<Animal> Make() { await Task.Yield(); return new Animal(); } static async Task Main() { Console.WriteLine(Make()); await Make(); }',
  );
  assert.match(notExecutable(printed).message, /converting a constructed generic type to 'object'/);
  // Numeric values are supported; unregistered Task<long> contracts remain a separate capability.
  const wide = asyncProgram('', 'static async Task<long> Make() { await Task.Yield(); return 1; } static async Task Main() { await Make(); }');
  assert.match(notExecutable(wide).message, /framework registry has no.*Task<long>/);
});
