/**
 * SF-A02-T45: lock, using, checked and unchecked statements. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/statement-lowering.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program {\n${body}\n}\n`;
const codes = (source, severity = 'error') =>
  compile(source)
    .diagnostics.filter(d => d.severity === severity && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);

test('SF-A02-T45 lock needs a reference type; a type parameter that may be one is accepted (CS0185)', () => {
  const source = program(`
    enum Level { Low }
    static void Main() {
      lock (1) { }
      lock (Level.Low) { }
      lock ("text") { }
      lock (new object()) { }
    }
    static void Generic<T, V>(T open, V value) where V : struct {
      lock (open) { }
      lock (value) { }
    }`);
  assert.deepEqual(codes(source), ['CS0185 1', 'CS0185 Level.Low', 'CS0185 value']);
  const message = compile(source).diagnostics.find(d => d.code === 'CS0185').message;
  assert.equal(message, "'int' is not a reference type as required by the lock statement");
});

test('SF-A02-T45 a lock statement is valid C# the runtime cannot run: one SF2200 naming System.Threading.Monitor', () => {
  const source = program(`
    static object gate = new object();
    static void Main() {
      lock (gate) { Console.WriteLine(1); }
    }`);
  assert.deepEqual(codes(source), []);
  const reported = notExecutable(source);
  assert.match(reported.message, /a lock statement \(the runtime has no System\.Threading\.Monitor\)/);
  assert.equal(source.slice(reported.start, reported.start + reported.length), 'lock');
});

test('SF-A02-T45 new object() is a reference with identity on both back ends', () => {
  const lines = linesOf(
    program(`
    delegate void Marker();
    static void Main() {
      object first = new object(), second = new object(), alias = first;
      Console.WriteLine(first == alias);
      Console.WriteLine(first == second);
      Console.WriteLine(first != null);
      Console.WriteLine(first);
    }`),
  );
  assert.deepEqual(lines, ['True', 'False', 'True', 'System.Object']);
});

test('SF-A02-T45 checked and unchecked blocks set the overflow context of the operators inside them', () => {
  const lines = linesOf(
    program(`
    delegate void Marker();
    static void Main() {
      int large = 2147483647, small = -2147483647 - 1;
      unchecked { Console.WriteLine(large + 1); Console.WriteLine(small - 1); Console.WriteLine(-small); }
      checked {
        try { large++; } catch (Exception) { Console.WriteLine("increment"); }
        try { small -= 1; } catch (Exception) { Console.WriteLine("compound"); }
        try { Console.WriteLine(-small); } catch (Exception) { Console.WriteLine("negate"); }
        unchecked { Console.WriteLine(large * 2); }
      }
    }`),
  );
  assert.deepEqual(lines, ['-2147483648', '2147483647', '-2147483648', 'increment', 'compound', 'negate', '-2']);
});

test('SF-A02-T45 CS1674 covers the resource declaration of a using statement, in and outside the execution profile', () => {
  const inProfile = program(`
    static void Main() {
      using (Program wrong = new Program()) { }
    }`);
  assert.deepEqual(codes(inProfile), ['CS1674 Program wrong = new Program()']);
  const outside = program(`
    delegate void Marker();
    static void Main() {
      using (Program wrong = new Program()) { }
      using (new Program()) { }
    }`);
  assert.deepEqual(codes(outside), ['CS1674 Program wrong = new Program()', 'CS1674 new Program()']);
});
