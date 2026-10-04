import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

function run(source, expected) {
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const routes = [
    ['source', () => new VirtualMachine(result.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(result.assembly))],
    ['direct CIL', () => new CilVirtualMachine(result.assembly)],
  ];
  for (const [name, create] of routes) {
    const actual = create().run();
    assert.equal(actual.state, 'terminated', name + ': ' + actual.fault?.stack);
    assert.equal(actual.output, expected, name);
  }
}

test('A05 scalar tuple formatting preserves unsigned bits, Decimal scale and Single text', () => {
  run(`using System;
    class Program { static void Main() {
      (uint, ulong, decimal, float) value = (uint.MaxValue, ulong.MaxValue, 1.2300m, 0.1f);
      Console.WriteLine(value);
      Console.WriteLine("value=" + value);
      Console.WriteLine(value.ToString());
    } }`, '(4294967295, 18446744073709551615, 1.2300, 0.1)\n' +
    'value=(4294967295, 18446744073709551615, 1.2300, 0.1)\n' +
    '(4294967295, 18446744073709551615, 1.2300, 0.1)\n');
});

test('A05 synthesized member equality distinguishes Single.Equals from the tuple equality operator', () => {
  run(`using System;
    record Row((float, decimal) Value);
    class Program { static void Main() {
      var left = new Row((float.NaN, 1.00m));
      var right = new Row((float.NaN, 1m));
      Console.WriteLine(left.Equals(right));
      Console.WriteLine(left.Value == right.Value);
      Console.WriteLine(left.Equals(new Row((float.NaN, 2m))));
    } }`, 'True\nFalse\nFalse\n');
});

test('A05 typed tuple updates preserve copies and prefix/postfix result identity', () => {
  run(`using System;
    class Program { static void Main() {
      (long, decimal, byte) value = (2147483647L, 1.20m, (byte)255);
      var copy = value;
      Console.WriteLine(value.Item1++);
      Console.WriteLine(++value.Item2);
      value.Item3++;
      Console.WriteLine(value);
      Console.WriteLine(copy);
    } }`, '2147483647\n2.20\n(2147483648, 2.20, 0)\n(2147483647, 1.20, 255)\n');
});

test('A05 checked tuple narrowing fails before publishing a replacement value', () => {
  run(`using System;
    class Program { static void Main() {
      (byte, long) value = ((byte)255, 7L);
      try { checked { value.Item1++; } } catch (Exception) { Console.WriteLine("overflow"); }
      Console.WriteLine(value);
      try { checked { value.Item1 += 2; } } catch (Exception) { Console.WriteLine("overflow"); }
      Console.WriteLine(value);
    } }`, 'overflow\n(255, 7)\noverflow\n(255, 7)\n');
});

test('A05 scalar indexer updates evaluate receiver, index, getter and setter once', () => {
  run(`using System;
    class Box {
      public decimal Value = 1.20m;
      public int Gets; public int Sets;
      public decimal this[int index] {
        get { Gets++; return Value; }
        set { Sets++; Value = value; }
      }
    }
    class Program {
      static int Receivers; static int Indices;
      static Box Box = new Box();
      static Box Receiver() { Receivers++; return Box; }
      static int Index() { Indices++; return 0; }
      static void Main() {
        Console.WriteLine(Receiver()[Index()]++);
        Console.WriteLine(Receiver()[Index()] += 0.30m);
        Console.WriteLine(Box.Value);
        Console.WriteLine(Receivers); Console.WriteLine(Indices);
        Console.WriteLine(Box.Gets); Console.WriteLine(Box.Sets);
      }
    }`, '1.20\n2.50\n2.50\n2\n2\n2\n2\n');
});

test('A05 scalar changes preserve wide tuple Rest lowering and value copies', () => {
  run(`using System;
    class Program { static void Main() {
      var value = (1U, 2L, 3m, 4f, 5U, 6L, 7m, 8UL, 9f);
      var before = value;
      value.Item8++;
      Console.WriteLine(value.Rest);
      Console.WriteLine(before.Rest);
      Console.WriteLine(value.Item8);
    } }`, '(9, 9)\n(8, 9)\n9\n');
});
