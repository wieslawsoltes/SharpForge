/**
 * Differential fixtures for three binder defects reported against the C# 9-12 rules: an object initializer of a
 * struct (a false CS1612 on every member), optional parameters of a primary constructor (their defaults were never
 * bound, so `new R()` was not executable and a wrong default was not reported), and a lambda as an element of an
 * explicitly typed array initializer (it was never bound against the element type).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('struct-object-initializers', [
    out(
      'fields-and-properties',
      cs`
        using System;
        struct V
        {
            public int X;
            public int Y { get; set; }
            public static V operator +(V a, V b) => new V { X = a.X + b.X, Y = a.Y + b.Y };
        }
        class Holder { public V Value; }
        class Program
        {
            static V Make(int x) => new V { X = x };
            static void Main()
            {
                var sum = new V { X = 1, Y = 2 } + Make(3);
                Console.WriteLine(sum.X + " " + sum.Y);
                var holder = new Holder { Value = { X = 5 } };
                Console.WriteLine(holder.Value.X);
            }
        }
      `,
    ),
    diag(
      'cs1612-cs1918-members-of-a-value',
      cs`
        struct V { public int X; }
        class Holder { public V Property { get; set; } public static V Make() => new V(); }
        class Program
        {
            static void Main()
            {
                Holder.Make().X = 1;
                var holder = new Holder { Property = { X = 5 } };
                holder.Property.X = 2;
            }
        }
      `,
    ),
  ]),
  ...feature('primary-constructor-defaults', [
    out(
      'records-and-classes',
      cs`
        using System;
        record Named(string Name = "n", int Rank = 2);
        class Counter(int start = 10, int step = 1)
        {
            public int Next() => start += step;
        }
        class Program
        {
            static void Main()
            {
                Console.WriteLine(new Named().Name);
                Console.WriteLine(new Named("x").Rank);
                Console.WriteLine(new Named(Rank: 7).Name + new Named(Rank: 7).Rank);
                Console.WriteLine(new Counter().Next());
                Console.WriteLine(new Counter(step: 5).Next());
                Console.WriteLine(new Counter(1, 2).Next());
            }
        }
      `,
    ),
    diag(
      'cs1750-cs1736-invalid-defaults',
      cs`
        record Wrong(string Name = 5);
        record NotConstant(int Value = Program.Compute());
        class Sized(int size = "big") { public int Size => size; }
        class Program
        {
            public static int Compute() => 1;
            static void Main() { }
        }
      `,
    ),
  ]),
  ...feature('lambda-array-elements', [
    out(
      'explicitly-typed-initializers',
      cs`
        using System;
        class Program
        {
            static Func<int, int>[] steps = { x => x + 1, x => x * 2 };
            static void Main()
            {
                int offset = 3;
                Func<int, int>[] local = { x => x + offset, delegate (int x) { return x - offset; } };
                var created = new Func<int, string>[] { x => "v" + x, x => (x * 2).ToString() };
                Action[] actions = new Action[2] { () => Console.WriteLine("first"), () => Console.WriteLine("second") };
                Console.WriteLine(steps[0](4) + " " + steps[1](4));
                Console.WriteLine(local[0](4) + " " + local[1](4));
                Console.WriteLine(created[0](4) + " " + created[1](4));
                foreach (var action in actions) action();
            }
        }
      `,
    ),
    diag(
      'cs1661-cs0029-element-mismatch',
      cs`
        using System;
        class Program
        {
            static void Main()
            {
                Func<int, int>[] wrong = { (string s) => 1, x => "text" };
            }
        }
      `,
    ),
  ]),
];
