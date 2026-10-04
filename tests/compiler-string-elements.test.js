import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { BuiltinMap, disassemble } from '@sharpforge/bytecode';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { linesOf } from './support/semantic-codegen.js';

// SF-A02-T46: the elements of a string, lowered onto the runtime's string.get_Chars intrinsic.
// Expected lines are what .NET 10 prints (the same programs are pinned in the differential corpus, string-elements/*).

const inMain = statements => `using System;
  class Program { static void Main() { string s = "héllo"; ${statements} } }`;

test('A02-T46 s[i] reads a UTF-16 code unit as a char on both back ends', () => {
  const lines = linesOf(
    inMain(`Console.WriteLine(s[1]); Console.WriteLine((int)s[1]); Console.WriteLine(s[0] == 'h');
      Console.WriteLine(s[2] + 1); Console.WriteLine("" + s[4] + s[3]); Console.WriteLine(s[^1]);
      char first = s[0]; first++; Console.WriteLine(first);`),
  );
  assert.deepEqual(lines, ['é', '233', 'True', '109', 'ol', 'o', 'i']);
});

test('A02-T46 the element access is one call of the string.get_Chars intrinsic followed by a conversion to char', () => {
  const result = compile(inMain('char c = s[1]; Console.WriteLine(c);'));
  assert.equal(result.success, true);
  const main = disassemble(result.image).find(method => method.name.endsWith('Main')),
    calls = main.instructions.filter(i => i.op === 'BUILTIN' && i.a === BuiltinMap.get('string.get_Chars').id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].b, 2, 'the receiver and the index are the two operands');
  assert.equal(main.instructions[main.instructions.indexOf(calls[0]) + 1].op, 'CONVERT');
});

test('A02-T46 foreach over a string evaluates the string once and yields each char', () => {
  const lines = linesOf(`using System;
    using System.Collections.Generic;
    class Program {
      static int evaluations;
      static string Text() { evaluations++; return "a-b-c"; }
      static IEnumerable<int> Codes(string text) { foreach (char c in text) yield return c; }
      static void Main() {
        int dashes = 0; string reversed = "";
        foreach (char c in Text()) { if (c == '-') { dashes++; continue; } reversed = c + reversed; }
        Console.WriteLine(dashes + " " + reversed + " " + evaluations);
        foreach (var c in "ab") Console.WriteLine(c + 1);
        foreach (int code in "A") Console.WriteLine(code);
        foreach (char c in "xyz") { if (c == 'y') break; Console.WriteLine(c); }
        foreach (char c in "") Console.WriteLine("never");
        foreach (int code in Codes("xy")) Console.WriteLine(code);
        int total = 0;
        foreach (char c in "12") { Func<int> read = () => c - '0'; total += read(); }
        Console.WriteLine(total);
      }
    }`);
  assert.deepEqual(lines, ['2 cba 1', '98', '99', '65', 'x', '120', '121', '3']);
});

test('A02-T46 an index outside the string and a null string throw inside the program', () => {
  const lines = linesOf(`using System;
    class Program { static void Main() {
      string s = "ab", none = null;
      try { Console.WriteLine(s[2]); } catch (Exception) { Console.WriteLine("range"); }
      try { Console.WriteLine(s[-1]); } catch (Exception) { Console.WriteLine("negative"); }
      try { Console.WriteLine(none[0]); } catch (Exception) { Console.WriteLine("null element"); }
      try { foreach (char c in none) Console.WriteLine(c); } catch (Exception) { Console.WriteLine("null loop"); }
    } }`);
  assert.deepEqual(lines, ['range', 'negative', 'null element', 'null loop']);
});

test('A02-T46 an unhandled out-of-range read faults with IndexOutOfRangeException on both back ends', () => {
  const source = inMain('Console.WriteLine(s[4]); Console.WriteLine(s[5]);'),
    bytecode = new VirtualMachine(compile(source).image).run(),
    cil = new CilVirtualMachine(compileToIL(source, { includeDebug: false }).assembly).run();
  for (const run of [bytecode, cil]) {
    assert.equal(run.state, 'faulted');
    assert.equal(run.fault.name, 'IndexOutOfRangeException');
    assert.equal(run.output, 'o\n');
  }
});

test('A02-T46 a string element is read-only and its type is char', () => {
  const errors = source => compile(source).diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code)).map(d => d.code);
  assert.deepEqual(errors(inMain("s[0] = 'x';")), ['CS0200']);
  assert.deepEqual(errors(inMain('foreach (string part in s) Console.WriteLine(part);')), ['CS0030']);
  assert.deepEqual(errors(inMain('string part = s[0];')), ['CS0029']);
});
