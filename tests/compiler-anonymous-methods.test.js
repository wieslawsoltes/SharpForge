/**
 * SF-A02-T51: anonymous methods. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/anonymous-methods.js; these tests cover the boundaries of the
 * signature rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

const codes = source =>
  compile(source)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);

test('SF-A02-T51 an anonymous method without a parameter list fits any signature that has no out parameter', () => {
  const source = `
    delegate void ByRef(ref int value, string text);
    delegate void WithOut(int first, out int value);
    class Program {
      static void Main() {
        ByRef fine = delegate { };
        WithOut wrong = delegate { };
      }
    }`;
  assert.deepEqual(codes(source), ['CS1688 delegate']);
});

test('SF-A02-T51 the ref kinds of an explicit parameter list are the delegate\'s (CS1676, CS1677)', () => {
  const source = `
    delegate void ByRef(ref int value);
    delegate void ByValue(int value);
    class Program {
      static void Main() {
        ByRef same = delegate(ref int value) { value++; };
        ByRef missing = delegate(int value) { };
        ByValue extra = delegate(ref int value) { };
        ByRef other = delegate(out int value) { value = 1; };
      }
    }`;
  assert.deepEqual(codes(source), ['CS1676 value', 'CS1677 value', 'CS1676 value']);
});

test('SF-A02-T51 a by-reference parameter of the enclosing method is not usable in an anonymous function (CS1628)', () => {
  const source = `
    delegate int Next();
    class Program {
      static void Run(ref int total, in int step, int plain) {
        Next a = delegate { return total + plain; };
        Next b = () => step;
        Next own = delegate { int total2 = plain; return total2; };
      }
      static void Main() { }
    }`;
  assert.deepEqual(codes(source), ['CS1628 total', 'CS1628 step']);
});

test('SF-A02-T51 an anonymous method that ignores its parameters runs on both back ends', () => {
  const lines = linesOf(`
    using System;
    delegate string Describe(int code, string name);
    class Program {
      static void Main() {
        int calls = 0;
        Describe constant = delegate { calls++; return "any"; };
        Console.WriteLine(constant(1, "a") + constant(2, "b") + calls);
      }
    }`);
  assert.deepEqual(lines, ['anyany2']);
});
