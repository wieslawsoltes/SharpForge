/**
 * Differential fixtures for extension method declarations and delegates over them (SF-A02-E05): CS1100, CS1104,
 * CS1105, CS1106, CS1109, CS1103, CS8328, CS8337, CS8338, CS1113; an extension method group converts to a delegate
 * when its receiver is a reference type, and the receiver takes part in choosing the overload.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('extension-declarations', [
  diag(
    'cs1100-cs1104-cs1105-cs8328-cs8337-this-parameter',
    cs`
      static class A
      {
          public static int Ok(this int x) { return x; }
          public static int NotFirst(int a, this int x) { return x; }
          public int Inst(this int x) { return x; }
          public static void Two(this int a, this int b) { }
          public static void Par(this params int[] a) { }
          public static void RefClass(ref this string s) { }
          public static void InClass(in this string s) { }
          public static void OutThis(out this int s) { s = 1; }
          public static void Dyn(this dynamic d) { }
          public static void RefValue(ref this int x) { x = 1; }
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs1106-cs1109-where-extensions-may-be-declared',
    cs`
      class NonStatic
      {
          public static int E(this int x) { return x; }
          public static int F(this int x) { return x; }
      }
      static class Generic<T>
      {
          public static int E(this int x) { return x; }
      }
      static class Outer
      {
          public static class Nested { public static int E(this int x) { return x; } }
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs1113-cs0428-delegates-over-extension-methods',
    cs`
      using System;
      static class A
      {
          public static int Ok(this int x) { return x; }
          public static int Len(this string s) { return s.Length; }
          public static string Tag(this object o) { return "obj"; }
          public static string Tag(this string s) { return "str"; }
      }
      class Program
      {
          static void Main()
          {
              Func<int> f = 7.Ok;
              Func<int> g = "s".Len;
              Func<string> h = "x".Tag;
              Func<int, int> open = A.Ok;
              int n = 5.Ok;
              Func<string> wrong = "s".Len;
              Console.WriteLine(g() + h() + open(1));
          }
      }
    `,
  ),
  out(
    'instance-methods-win-and-the-nearest-receiver-type',
    cs`
      using System;
      static class A
      {
          public static int Twice(this int x) { return x * 2; }
          public static string Tag(this object o) { return "obj"; }
          public static string Tag(this string s) { return "str"; }
          public static int Count(this int[] a) { return a.Length; }
      }
      class C { public string Tag() { return "inst"; } }
      class Program
      {
          static void Main()
          {
              Console.WriteLine(3.Twice().Twice());
              Console.WriteLine("s".Tag() + " " + new C().Tag() + " " + new int[2].Count());
              Console.WriteLine(A.Twice(5));
              string nothing = null;
              Console.WriteLine(nothing.Tag());
          }
      }
    `,
  ),
  out(
    'delegates-over-extension-methods-close-over-the-receiver',
    cs`
      using System;
      delegate string Describe(int times);
      class Counter
      {
          public int Count;
          public Counter(int start) { Count = start; }
      }
      static class Extensions
      {
          public static int Len(this string s) { return s.Length; }
          public static string Repeat(this string s, int times) { string r = ""; for (int i = 0; i < times; i++) r += s; return r; }
          public static void Bump(this Counter c) { c.Count++; }
          public static int Add(this Counter c, int a, int b) { return c.Count + a + b; }
          public static string Tag(this object o) { return "object"; }
          public static string Tag(this string s) { return "string:" + s; }
      }
      class Program
      {
          static string Next(ref int calls) { calls++; return "r" + calls; }
          static void Main()
          {
              Func<int> len = "hello".Len;
              Console.WriteLine(len());
              Describe repeat = "ab".Repeat;
              Console.WriteLine(repeat(3));
              var counter = new Counter(10);
              Action bump = counter.Bump;
              bump(); bump();
              Console.WriteLine(counter.Count);
              Func<int, int, int> add = counter.Add;
              Console.WriteLine(add(1, 2));
              Func<string> tag = "x".Tag;
              Console.WriteLine(tag());
              // The receiver is evaluated once, when the delegate is created.
              int calls = 0;
              Func<int> once = Next(ref calls).Len;
              Console.WriteLine(calls + " " + once() + " " + once() + " " + calls);
              // The receiver is captured by value: a later assignment does not change the delegate.
              string text = "one";
              Func<int> captured = text.Len;
              text = "three";
              Console.WriteLine(captured());
              Action both = counter.Bump;
              both += counter.Bump;
              both();
              Console.WriteLine(counter.Count);
              Console.WriteLine(Use("abcd".Len));
          }
          static int Use(Func<int> f) { return f() * 2; }
      }
    `,
  ),
]);
