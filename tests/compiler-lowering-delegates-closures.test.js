import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { loadAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { analyzeCaptures } from '../packages/compiler/src/lowering/closures.js';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { linesOf, runOnBothBackEnds } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program {\n${body}\n}\n`;

test('SF-A02-T07.1 a delegate invokes static and instance targets through its numbered dispatcher', () => {
  const lines = linesOf(`
    using System;
    delegate int Op(int a, int b);
    class Scale { int factor; public Scale(int factor) { this.factor = factor; } public int Apply(int a, int b) { return (a + b) * factor; } }
    class Program {
      static int Add(int a, int b) { return a + b; }
      static void Main() {
        Op add = Add;
        Op scaled = new Scale(10).Apply;
        Console.WriteLine(add(2, 3));
        Console.WriteLine(scaled(2, 3));
      }
    }`);
  assert.deepEqual(lines, ['5', '50']);
});

test('SF-A02-T07.1 multicast invocation runs targets in order and returns the last result', () => {
  const lines = linesOf(
    program(`
      static string log = "";
      static int A() { log += "A"; return 1; }
      static int B() { log += "B"; return 2; }
      static void Main() {
        Func<int> chain = A;
        chain += B;
        chain += A;
        Console.WriteLine(chain());
        Console.WriteLine(log);
      }`),
  );
  assert.deepEqual(lines, ['1', 'ABA']);
});

test('SF-A02-T07.1 removal drops the last occurrence of the invocation list and yields null when nothing is left', () => {
  const lines = linesOf(
    program(`
      static string log = "";
      static void A() { log += "A"; }
      static void B() { log += "B"; }
      static void Show(Action action) { log = ""; if (action != null) action(); Console.WriteLine(log == "" ? "-" : log); }
      static void Main() {
        Action a = A, b = B;
        Action list = a + b + a + b;
        Show(list - a);
        Show(list - (a + b));
        Show(list - (b + a));
        Show(list - (b + b));
        Action nothing = a - a;
        Console.WriteLine(nothing == null);
      }`),
  );
  assert.deepEqual(lines, ['ABB', 'AB', 'AB', 'ABAB', 'True']);
});

test('SF-A02-T07.1 invoking a null delegate faults with NullReferenceException', () => {
  const result = compile(program(`static void Main() { Action nothing = null; nothing(); }`));
  assert.equal(result.success, true);
  const run = new VirtualMachine(result.image).run();
  assert.equal(run.state, 'faulted');
  assert.equal(run.fault.name, 'NullReferenceException');
});

test('SF-A02-T07.2 lambdas take their parameter and return types from the delegate they convert to', () => {
  const lines = linesOf(
    program(`
      static int Twice(Func<int, int> f, int x) { return f(f(x)); }
      static void Main() {
        Func<int, int, int> add = (a, b) => a + b;
        Func<string, int, string> repeat = (text, count) => { string s = ""; for (int i = 0; i < count; i++) s += text; return s; };
        Func<double, double> half = x => x / 2;
        Console.WriteLine(Twice(x => x * 3, add(1, 1)));
        Console.WriteLine(repeat("ab", 3));
        Console.WriteLine(half(5));
        Func<int, int> anonymous = delegate (int x) { return x + 100; };
        Console.WriteLine(anonymous(1));
      }`),
  );
  assert.deepEqual(lines, ['18', 'ababab', '2.5', '101']);
});

test('SF-A02-T07.3 the capture analysis finds captured variables transitively and ignores uncaptured ones', () => {
  const source = program(`
      static void Main() {
        int captured = 1, plain = 2, viaLocalFunction = 3;
        int Read() => viaLocalFunction;
        Func<int> direct = () => captured;
        Func<int> indirect = () => Read();
        Console.WriteLine(plain + direct() + indirect());
      }`);
  const analysis = analyze([parse(new SourceText(source, 'Program.cs'))]);
  const main = [...analysis.bound].find(([symbol]) => symbol.name === 'Main')[1];
  const captures = analyzeCaptures(main);
  assert.deepEqual([...captures.captured].map(v => v.name).sort(), ['captured', 'viaLocalFunction']);
  const lambdas = [...captures.functions].filter(([key]) => key.kind === 'Lambda').map(([, value]) => [...value.variables].map(v => v.name));
  assert.deepEqual(lambdas, [['captured'], ['viaLocalFunction']]);
});

test('SF-A02-T07.3 closures over loop variables: foreach and block locals are per iteration, a for variable is shared', () => {
  const lines = linesOf(
    program(`
      static void Main() {
        Func<int>[] each = new Func<int>[3], shared = new Func<int>[3], local = new Func<int>[3];
        int[] values = { 5, 6, 7 };
        int at = 0;
        foreach (int value in values) { each[at] = () => value; at++; }
        for (int i = 0; i < 3; i++) { shared[i] = () => i; int twice = i * 2; local[i] = () => twice; }
        Console.WriteLine(each[0]() + "" + each[1]() + each[2]());
        Console.WriteLine(shared[0]() + "" + shared[1]() + shared[2]());
        Console.WriteLine(local[0]() + "" + local[1]() + local[2]());
      }`),
  );
  assert.deepEqual(lines, ['567', '333', '024']);
});

test('SF-A02-T07.3 nested lambdas, captured this and captured parameters share one variable with their method', () => {
  const lines = linesOf(`
    using System;
    class Counter {
      int total;
      public Func<int, Func<int>> Adder(int step) {
        step = step + 1;
        return times => () => { total += step * times; return total; };
      }
    }
    class Program {
      static void Main() {
        var counter = new Counter();
        var add = counter.Adder(1);
        add(1)();
        Console.WriteLine(add(10)());
        int shared = 0;
        Action bump = () => shared++;
        bump();
        shared += 10;
        bump();
        Console.WriteLine(shared);
      }
    }`);
  assert.deepEqual(lines, ['22', '12']);
});

test('SF-A02-T07.3 a lambda that captures nothing is a static method and allocates no display class', () => {
  const { image } = runOnBothBackEnds(program(`static void Main() { Func<int, int> square = x => x * x; Console.WriteLine(square(4)); }`));
  assert.ok(!image.types.some(t => t.name.includes('DisplayClass')));
  const lambda = image.methods.find(m => m.name.startsWith('<Main>b__'));
  assert.equal(lambda.isStatic, true);
});

test('SF-A02-T07.3 a capturing lambda is a method of a Roslyn-named display class holding cells', () => {
  const { image } = runOnBothBackEnds(program(`static void Main() { int n = 2; Func<int, int> scale = x => x * n; Console.WriteLine(scale(4)); }`));
  const display = image.types.find(t => /^<>c__DisplayClass\d+_\d+$/.test(t.name));
  assert.ok(display, 'a display class exists');
  assert.deepEqual(
    display.fields.map(f => f.name),
    ['n'],
  );
  const lambda = image.methods.find(m => m.owner === display.name);
  assert.match(lambda.name, /^<Main>b__\d+_\d+$/);
  assert.equal(lambda.isStatic, false);
});

test('SF-A02-T07.4 local functions: recursion, captured state, mutation, nesting and delegate conversion', () => {
  const lines = linesOf(
    program(`
      static void Main() {
        int calls = 0;
        int Fib(int n) { calls++; return n < 2 ? n : Fib(n - 1) + Fib(n - 2); }
        Console.WriteLine(Fib(8) + " " + calls);
        int total = 0;
        void Add(int amount) { total += amount; }
        Add(5); Add(7);
        Console.WriteLine(total);
        int Outer(int x) { int Inner(int y) => y + total + x; return Inner(1); }
        Console.WriteLine(Outer(100));
        Func<int, int> asDelegate = Outer;
        total = 1000;
        Console.WriteLine(asDelegate(0));
        static int Pure(int x) => x - 1;
        Console.WriteLine(Pure(1));
      }`),
  );
  assert.deepEqual(lines, ['21 67', '12', '113', '1001', '0']);
});

test('SF-A02-T07.4 a local function that is only called allocates no display class', () => {
  const { image } = runOnBothBackEnds(
    program(`static void Main() { int seed = 3; int Next(int x) => x + seed; Console.WriteLine(Next(1)); }`),
  );
  assert.ok(!image.types.some(t => t.name.includes('DisplayClass')));
  const local = image.methods.find(m => m.name.startsWith('<Main>g__Next|'));
  assert.ok(local?.isStatic, 'the local function is a static method');
  assert.equal(local.parameters.length, 2, 'it receives the captured cell as an extra parameter');
});

test('SF-A02-T07.6 field-like events combine and remove handlers; accessors are called when declared', () => {
  const lines = linesOf(`
    using System;
    delegate void Notify(int value);
    class Source {
      public event Notify Raised;
      Notify custom;
      public int Subscribed;
      public event Notify Custom { add { Subscribed++; custom += value; } remove { Subscribed--; custom -= value; } }
      public void Fire(int value) { Raised?.Invoke(value); if (custom != null) custom(value * 2); }
    }
    class Program {
      static int sum;
      static void Add(int value) { sum += value; }
      static void Main() {
        var source = new Source();
        source.Fire(1);
        source.Raised += Add;
        source.Raised += Add;
        source.Custom += Add;
        source.Fire(10);
        Console.WriteLine(sum + " " + source.Subscribed);
        source.Raised -= Add;
        source.Custom -= Add;
        source.Fire(100);
        Console.WriteLine(sum + " " + source.Subscribed);
      }
    }`);
  assert.deepEqual(lines, ['40 1', '140 0']);
});

test('SF-A02-T07.6 raising an event outside its type reports CS0070', () => {
  const result = compile(`
    using System;
    class Source { public event Action Raised; }
    class Program { static void Main() { var s = new Source(); s.Raised(); } }`);
  assert.ok(result.diagnostics.some(d => d.code === 'CS0070'));
  assert.equal(result.image, null);
});

test('a registered delegate variable crosses Task.Run while custom delegates retain source dispatch', async () => {
  const compiled = compileToIL(`
    using System;
    using System.Threading.Tasks;
    delegate void Work();
    class Program {
      static void Main() {
        Action work = () => Console.WriteLine("x");
        Task.Run(work).Wait();
        Work custom = () => Console.WriteLine("custom");
        custom();
        Work missing = null;
        if (missing != null) missing();
      }
    }`);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const engine of ['source', 'reload', 'cil']) {
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly, {virtualTime: true})
      : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, {virtualTime: true});
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
      assert.equal(result.output, 'x\ncustom\n', engine);
    } finally { vm.stop(); }
  }
});
