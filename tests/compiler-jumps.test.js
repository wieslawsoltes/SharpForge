/**
 * SF-A02-T43: goto, labels and the control-flow rules of switch sections. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/jumps.js; these tests cover label scoping and the lowered jumps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program {\n${body}\n}\n`;
const codes = (source, severity = 'error') =>
  compile(source)
    .diagnostics.filter(d => d.severity === severity && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);

test('SF-A02-T43 a label is scoped to its block: sibling blocks may reuse a name and cannot be jumped into', () => {
  const reuse = program(`
    static void Main() {
      int a = 0, b = 0;
      { again: a++; if (a < 3) goto again; }
      { again: b += 2; if (b < 10) goto again; }
      Console.WriteLine(a + " " + b);
    }`);
  assert.deepEqual(codes(reuse), []);
  assert.deepEqual(linesOf(reuse), ['3 10']);
  const into = program(`
    static void Main() {
      { inner: Console.WriteLine(1); goto inner; }
      { goto inner; }
    }`);
  assert.deepEqual(codes(into), ['CS0159 inner']);
});

test('SF-A02-T43 a label of the enclosing method is not a target for a lambda body (CS0159 on the goto keyword)', () => {
  const source = program(`
    delegate void Step();
    static void Main() {
      top:
      Step step = delegate { goto top; };
      step();
      if (step == null) goto top;
    }`);
  assert.deepEqual(codes(source), ['CS0159 goto']);
});

test('SF-A02-T43 goto case converts its constant to the governing type and finds the section by value', () => {
  const lines = linesOf(
    program(`
    enum Level { Low, Mid, High }
    const int Two = 1 + 1;
    static string Walk(Level level) {
      string log = "";
      switch (level) {
        case Level.Low: log += "low "; goto case Level.High;
        case Level.Mid: log += "mid "; goto default;
        case Level.High: log += "high "; break;
        default: log += "other "; break;
      }
      return log;
    }
    static void Main() {
      Console.WriteLine(Walk(Level.Low) + "|" + Walk(Level.Mid) + "|" + Walk((Level)9));
      int number = 1;
      switch (number) {
        case 1: Console.WriteLine("one"); goto case 2;
        case Two: Console.WriteLine("two"); break;
      }
    }`),
  );
  assert.deepEqual(lines, ['low high |mid other |other ', 'one', 'two']);
});

test('SF-A02-T43 goto case reports a missing constant, a missing label and a value of another type', () => {
  const source = program(`
    static void Main() {
      int n = 1;
      switch (n) {
        case 1: goto case 3;
        case 2: goto case n;
        default: goto case "x";
      }
    }`);
  assert.deepEqual(codes(source), [
    'CS0163 case 1:',
    'CS0159 goto case 3;',
    'CS0163 case 2:',
    'CS0150 goto case n;',
    'CS8070 default:',
    'CS0029 goto case "x";',
  ]);
  const message = compile(source).diagnostics.find(d => d.code === 'CS0159').message;
  assert.equal(message, "No such label 'case 3:' within the scope of the goto statement");
});

test('SF-A02-T43 an explicit-only conversion of a goto case value is the warning CS0469 and the jump still binds', () => {
  const source = program(`
    static void Main() {
      int n = 1;
      switch (n) {
        case 1: goto case 2.0;
        case 2: Console.WriteLine("two"); break;
      }
    }`);
  assert.deepEqual(codes(source), []);
  assert.deepEqual(codes(source, 'warning'), ['CS0469 goto case 2.0;']);
  assert.deepEqual(linesOf(source), ['two']);
});

test('SF-A02-T43 a jump out of a try block runs the finally blocks it leaves, innermost first', () => {
  const lines = linesOf(
    program(`
    static void Main() {
      int n = 1;
      switch (n) {
        case 1:
          try {
            try { goto case 2; }
            finally { Console.WriteLine("inner"); }
          }
          finally { Console.WriteLine("outer"); }
        case 2:
          Console.WriteLine("two");
          break;
      }
      try { goto done; }
      finally { Console.WriteLine("last"); }
      done:
      Console.WriteLine("done");
    }`),
  );
  assert.deepEqual(lines, ['inner', 'outer', 'two', 'last', 'done']);
});

test('SF-A02-T43 no jump leaves a finally block; a jump that stays inside one is allowed', () => {
  const source = program(`
    static void Main() {
      for (int i = 0; i < 2; i++) {
        try { }
        finally {
          for (int j = 0; j < 2; j++) { if (j == 0) continue; break; }
          if (i == 0) break;
        }
      }
    }`);
  assert.deepEqual(codes(source), ['CS0157 break']);
});

test('SF-A02-T43 break and continue without a target are errors that do not end the statement list', () => {
  const source = program(`
    static void Main() {
      break;
      continue;
      Console.WriteLine(1);
    }`);
  assert.deepEqual(codes(source), ['CS0139 break;', 'CS0139 continue;']);
  assert.deepEqual(codes(source, 'warning'), []);
});
