/**
 * Differential fixtures for SF-A02-T30: `foreach (ref var x in ...)` and `foreach (ref readonly var x in ...)`
 * (C# 7.3) over an enumerator whose `Current` returns by reference, and `nint` / `nuint` named in an expression.
 */
import { cs, out, diag, feature } from './kit.js';

const grid = `
    class Grid
    {
        int[] data = { 1, 2, 3 };
        public Enumerator GetEnumerator() { return new Enumerator(data); }
        public struct Enumerator
        {
            int[] data; int index;
            public Enumerator(int[] data) { this.data = data; index = -1; }
            public bool MoveNext() { return ++index < data.Length; }
            public ref int Current { get { return ref data[index]; } }
        }
    }
    class Frozen
    {
        int[] data = { 4, 5 };
        public Enumerator GetEnumerator() { return new Enumerator(data); }
        public struct Enumerator
        {
            int[] data; int index;
            public Enumerator(int[] data) { this.data = data; index = -1; }
            public bool MoveNext() { return ++index < data.Length; }
            public ref readonly int Current { get { return ref data[index]; } }
        }
    }`;

export const fixtures = [
  ...feature('ref-foreach', [
    out(
      'iteration-variables-alias-the-elements',
      cs`
    using System;
    ${grid}
    class Program
    {
        static void Main()
        {
            var grid = new Grid();
            foreach (ref var g in grid) g += 10;
            foreach (ref int g in grid) g *= 2;
            foreach (var g in grid) Console.Write(g + " ");
            Console.WriteLine();
            int sum = 0;
            foreach (ref readonly var g in grid) sum += g;
            foreach (ref readonly int f in new Frozen()) sum += f;
            Console.WriteLine(sum);
            foreach (ref var g in grid) { ref int alias = ref g; alias++; if (g > 24) break; }
            foreach (var g in grid) Console.Write(g + " ");
            Console.WriteLine();
        }
    }
  `,
    ),
    diag(
      'ref-needs-a-current-that-returns-by-reference',
      cs`
    using System;
    using System.Collections.Generic;
    ${grid}
    class Program
    {
        static void Main()
        {
            int[] array = { 1 };
            var list = new List<int> { 1 };
            foreach (ref var a in array) a++;
            foreach (ref var b in list) b++;
            foreach (ref readonly var c in array) Console.WriteLine(c);
            foreach (ref var d in "text") Console.WriteLine(d);
            foreach (ref var e in new Frozen()) e++;
            foreach (ref readonly var f in new Frozen()) f++;
            foreach (ref readonly var g in new Grid()) g = 1;
            foreach (var h in new Grid()) h = 1;
            int other = 0;
            foreach (ref var i in new Grid()) i = ref other;
        }
    }
  `,
    ),
    diag(
      'ref-foreach-in-7-2',
      cs`
    ${grid}
    class Program
    {
        static void Main()
        {
            foreach (ref var g in new Grid()) g++;
            foreach (ref readonly var f in new Frozen()) System.Console.WriteLine(f);
        }
    }
  `,
      { langVersion: '7.2' },
    ),
  ]),
  ...feature('native-integer-names', [
    out(
      'nint-and-nuint-name-their-types-in-expressions',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            Console.WriteLine((nint.Size == IntPtr.Size) + " " + (nuint.Size == UIntPtr.Size) + " " + nint.Zero + " " + nuint.MinValue);
            Console.WriteLine((nint.MaxValue > 0) + " " + (nint.MinValue < 0) + " " + nint.Parse("5") + " " + nuint.Parse("7"));
            nint value = nint.Zero + 3;
            Console.WriteLine(value + " " + nint.Equals(value, (nint)3));
        }
    }
  `,
    ),
    diag(
      'a-declared-nint-wins-over-the-keyword',
      cs`
    using System;
    class nint { public const int Size = 99; }
    class Program
    {
        static void Main()
        {
            Console.WriteLine(nint.Size);
            Console.WriteLine(nuint.Size);
            Console.WriteLine(nint.Missing);
            int nuint = 1;
            Console.WriteLine(nuint.Size);
        }
    }
  `,
    ),
  ]),
];
