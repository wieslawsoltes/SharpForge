/**
 * Differential fixtures for C# 14 first-class span conversions (SF-A02-T86): implicit span conversions from arrays,
 * spans and strings, span conversions on extension receivers, overload betterness between Span and ReadOnlySpan,
 * the explicit span conversions, and what the same programs mean at C# 13 (user-defined conversions only).
 * The output fixtures pin what .NET prints; `Span<T>` does not run on the execution profile yet, so SharpForge
 * reports them as not executable (SF2200) and only the diagnostics axes are compared.
 */
import { cs, out, diag, feature } from './kit.js';

const conversions = cs`
  using System;
  static class E
  {
      public static int First<T>(this ReadOnlySpan<T> span) { return span.Length; }
      public static int Writable<T>(this Span<T> span) { return span.Length + 100; }
  }
  class Program
  {
      static string Pick(Span<int> s) { return "Span"; }
      static string Pick(ReadOnlySpan<int> s) { return "ReadOnlySpan"; }
      static int Objects(ReadOnlySpan<object> s) { return s.Length; }
      static int Chars(ReadOnlySpan<char> s) { return s.Length; }
      static void Main()
      {
          int[] numbers = new int[] { 1, 2, 3 };
          string[] words = new string[] { "a", "b" };
          Span<int> span = numbers;
          ReadOnlySpan<int> readOnly = span;
          Console.WriteLine(span.Length + " " + readOnly.Length);
          Console.WriteLine(numbers.First() + " " + numbers.Writable() + " " + span.First());
          Console.WriteLine(Pick(numbers));
          Console.WriteLine(Objects(words) + " " + Chars("text"));
      }
  }
`;
const invalid = cs`
  using System;
  class Program
  {
      static void Main()
      {
          string[] words = new string[] { "a" };
          object[] objects = words;
          int[] numbers = new int[] { 1 };
          ReadOnlySpan<int> readOnly = numbers;
          Span<object> covariant = words;
          Span<string> narrowed = (Span<string>)objects;
          Span<string> implicitNarrowed = objects;
          Span<long> widened = numbers;
          Span<int> writable = readOnly;
          ReadOnlySpan<char> chars = "text";
          Span<char> writableChars = "text";
      }
  }
`;
const methodGroups = cs`
  using System;
  using System.Collections.Generic;
  static class E
  {
      public static void OnSpan(this Span<int> s, int x) { }
      public static void Both(this Span<int> s, int x) { }
      public static void Both(this IEnumerable<int> e, int x) { }
  }
  class Program
  {
      static void Main()
      {
          Action<int> both = new int[0].Both;
          Action<int> onSpan = new int[0].OnSpan;
          both(1); onSpan(1);
      }
  }
`;

export const fixtures = feature('first-class-spans', [
  out('conversions-receivers-and-betterness', conversions),
  diag('conversions-receivers-and-betterness-csharp-13', conversions, { langVersion: '13' }),
  diag('invalid-span-conversions', invalid),
  diag('invalid-span-conversions-csharp-13', invalid, { langVersion: '13' }),
  diag('method-group-receiver-has-no-span-conversion', methodGroups),
]);
