/** C# 12 collection inference and C# 13 collection-element betterness, including normal params-collection calls. */
import { cs, out, diag, feature } from './kit.js';

const elementBetterness = cs`
  using System;
  using System.Collections.Generic;
  class Program
  {
      static string Pick(List<int> values) => "ints:" + values.Count;
      static string Pick(List<byte> values) => "bytes:" + values.Count;
      static string Span(Span<int> values) => "writable:" + values.Length;
      static string Span(ReadOnlySpan<int> values) => "readonly:" + values.Length;
      static void Main()
      {
          Console.WriteLine(Pick([1, 2]));
          Console.WriteLine(Pick([(byte)1, (byte)2]));
          Console.WriteLine(Span([1, 2, 3]));
      }
  }
`;

const arrayBetterness = cs`
  using System;
  using System.Collections.Generic;
  class Program
  {
      static string Describe(ReadOnlySpan<object> values) => "span:" + values.Length;
      static string Describe(IEnumerable<object> values) => "sequence";
      static void Main()
      {
          string[] values = ["x", "y"];
          Console.WriteLine(Describe(values));
      }
  }
`;

export const fixtures = feature('collection-inference', [
  out('elements-spreads-and-nested-targets', cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static string JoinAll<T>(string separator, params IEnumerable<T> values) => typeof(T).Name + ":" + string.Join(separator, values);
        static string Arrays<T>(T[] values) => typeof(T).Name + ":" + values.Length;
        static string Nested<T>(List<T[]> values) => typeof(T).Name + ":" + values.Count + ":" + values[2].Length;
        static void Main()
        {
            string[] names = ["carol", "alice"];
            int[] numbers = [4, 5];
            Console.WriteLine(JoinAll("~", [.. names, "z"]));
            Console.WriteLine(JoinAll("/", [.. names]));
            Console.WriteLine(JoinAll("+", [1, 2L]));
            Console.WriteLine(Arrays([1, 2, 3]));
            Console.WriteLine(Nested([[1, 2], [], [.. numbers]]));
        }
    }
  `),
  out('deferred-lambda-and-method-group-output', cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static string Format(int value) => "value:" + value;
        static string Types<T, R>(IEnumerable<Func<T, R>> maps) => typeof(T).Name + ":" + typeof(R).Name;
        static R Apply<T, R>(T seed, List<Func<T, R>> maps) => maps[0](seed);
        static string Empty<T>(T seed, IEnumerable<T> values) => typeof(T).Name;
        static void Main()
        {
            Console.WriteLine(Types([(int value) => value.ToString()]));
            Console.WriteLine(Apply(7, [value => value.ToString()]));
            Console.WriteLine(Apply(9, [Format]));
            Console.WriteLine(Empty(1, []));
            Console.WriteLine(Empty("x", [null, default]));
        }
    }
  `),
  out('span-interface-collection-preference', cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static string Describe(ReadOnlySpan<object> values) => "span:" + values.Length;
        static string Describe(IEnumerable<object> values) => "sequence";
        static void Main()
        {
            Console.WriteLine(Describe(["p", "q", "r"]));
            Console.WriteLine(Describe([]));
            Console.WriteLine(Describe(new List<string> { "x" }));
        }
    }
  `),
  out('csharp13-element-preference', elementBetterness, { langVersion: '13' }),
  diag('csharp12-element-preference-is-ambiguous', elementBetterness, { langVersion: '12' }),
  out('csharp14-covariant-array-span-preference', arrayBetterness, { langVersion: '14' }),
  diag('csharp13-covariant-array-span-is-ambiguous', arrayBetterness, { langVersion: '13' }),
  diag('empty-typeless-incompatible-and-unconstrained-targets', cs`
    using System.Collections.Generic;
    class Program
    {
        static void Items<T>(IEnumerable<T> values) { }
        static void Value<T>(T value) { }
        static void Nested<T>(List<T[]> values) { }
        static void Main()
        {
            Items([]);
            Items([null]);
            Items([1, "text"]);
            Value([1, 2]);
            Nested([[], []]);
        }
    }
  `),
  diag('conflicting-and-empty-element-betterness', cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static void Pick(List<int> values) { }
        static void Pick(List<byte> values) { }
        static void Span(Span<string> values) { }
        static void Span(ReadOnlySpan<object> values) { }
        static void Main()
        {
            Pick([1, (byte)2]);
            Pick([]);
            Span([]);
        }
    }
  `, { langVersion: '13' }),
]);
