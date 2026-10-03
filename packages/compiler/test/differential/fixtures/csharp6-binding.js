/**
 * Differential fixtures for SF-A02-T61: `nameof` (any symbol, instance members from a static context, the shape
 * errors CS8081-CS8084), `using static` (what a simple name finds, CS0229, extension methods are not imported as
 * static methods) and exception filters (binding, CS7095 / CS8359 / CS8360 for constant filters).
 */
import { cs, out, diag, feature } from './kit.js';

const nameofFixtures = feature('nameof', [
  out(
    'names-of-locals-members-types-and-namespaces',
    cs`
      using System;
      using System.Collections.Generic;
      class C
      {
          public int Field;
          public void M() { }
          public void M(int x) { }
          public static int S;
          public int Prop { get; set; }
      }
      class Program
      {
          int inst;
          static void Main(string[] args)
          {
              int local = 1;
              Console.WriteLine(nameof(local));
              Console.WriteLine(nameof(args));
              Console.WriteLine(nameof(Program));
              Console.WriteLine(nameof(Main));
              Console.WriteLine(nameof(C.Field));
              Console.WriteLine(nameof(C.M));
              Console.WriteLine(nameof(C.Prop));
              Console.WriteLine(nameof(System.Console));
              Console.WriteLine(nameof(System));
              Console.WriteLine(nameof(System.Collections.Generic));
              Console.WriteLine(nameof(List<int>));
              Console.WriteLine(nameof(inst));
              Console.WriteLine(nameof(Program.inst));
              Console.WriteLine(nameof(String.Length));
              Console.WriteLine(nameof(Console.WriteLine));
              Console.WriteLine(nameof(args.Length));
              Console.WriteLine(nameof(C.Prop.ToString));
              const string k = nameof(local) + "!";
              Console.WriteLine(k);
              switch ("local") { case nameof(local): Console.WriteLine("case"); break; }
              Console.WriteLine(nameof(@local) + nameof(Int32));
          }
      }
    `,
  ),
  out(
    'a-method-named-nameof-wins',
    cs`
      using System;
      class Program
      {
          static string nameof(int x) { return "mine" + x; }
          static void Main()
          {
              int local = 1;
              Console.WriteLine(nameof(local));
          }
      }
    `,
  ),
  diag(
    'cs8081-cs8082-cs8083-cs8084-arguments-without-a-name',
    cs`
      class C { public int F; public void M() { } }
      class Program
      {
          static void Main()
          {
              int local = 1;
              var a = nameof(local + 1);
              var b = nameof(5);
              var h = nameof(new C().F);
              var i = nameof(typeof(C));
              var m = nameof(C.M<int>);
              var n = nameof(local.ToString());
              var p = nameof(global::C);
              var q = nameof("s".Length);
              var r = nameof(default(C).F);
          }
      }
    `,
  ),
  diag(
    'cs0103-cs0117-cs0120-arguments-that-do-not-bind',
    cs`
      class C { public int F; public void M() { } }
      class Program
      {
          static void Main()
          {
              int local = 1;
              var d = nameof(Missing);
              var e = nameof(C.Nope);
              var f = nameof();
              var g = nameof(local, local);
              var j = nameof(C.M());
              var l = nameof(this);
              var o = nameof(args[0]);
          }
      }
    `,
  ),
  diag(
    'cs9058-instance-member-in-nameof-in-csharp-11',
    cs`
      class Program
      {
          string text = "x";
          static string viaType = nameof(Program.text);
          static void Main()
          {
              System.Console.WriteLine(nameof(text));
              System.Console.WriteLine(nameof(text.Length));
          }
      }
    `,
    { langVersion: '11' },
  ),
]);

const usingStaticFixtures = feature('using-static', [
  out(
    'static-members-nested-types-and-enum-members',
    cs`
      using System;
      using static System.Console;
      using static System.Math;
      using static Util;
      static class Util
      {
          public static int Twice(int x) { return x * 2; }
          public const int K = 9;
          public static int Prop { get { return 3; } }
          public static int Ext(this int x) { return x + 1; }
      }
      class Program
      {
          static void Main()
          {
              WriteLine(Twice(4));
              WriteLine(Max(1, 2));
              WriteLine(K + Prop);
              WriteLine(Abs(-3));
              WriteLine(5.Ext());
          }
      }
    `,
  ),
  diag(
    'cs0229-cs0121-cs0104-the-same-name-from-two-types',
    cs`
      using System;
      using static A;
      using static B;
      static class A { public static int V = 1; public static void M() { } public static void N(int x) { } public class T { } }
      static class B { public static int V = 2; public static void M() { } public static void N(string x) { } public class T { } }
      class Program
      {
          static void Main()
          {
              Console.WriteLine(V);
              M();
              N(1);
              N("s");
              T t = null;
          }
      }
    `,
  ),
  diag(
    'cs0103-extension-and-instance-members-are-not-imported',
    cs`
      using System;
      using static Ext;
      using static Holder;
      static class Ext { public static int Twice(this int x) { return x * 2; } public static int Plain(int x) { return x; } }
      class Holder { public static int S = 3; public int I = 4; public static int M() { return 5; } }
      class Program
      {
          static void Main()
          {
              Console.WriteLine(4.Twice());
              Console.WriteLine(Plain(1));
              Console.WriteLine(Twice(4));
              Console.WriteLine(S + M());
              Console.WriteLine(I);
          }
      }
    `,
  ),
  diag(
    'cs7007-cs0246-what-using-static-may-name',
    cs`
      using static System;
      using static Missing;
      using static E;
      using static I;
      enum E { A, B }
      interface I { }
      class Program
      {
          static void Main()
          {
              System.Console.WriteLine(A);
          }
      }
    `,
  ),
]);

const filterFixtures = feature('exception-filters', [
  diag(
    'cs7095-cs8359-cs8360-constant-filters',
    cs`
      using System;
      class Program
      {
          static void Main()
          {
              try { }
              catch (Exception e) when (true) { }
              try { }
              catch (Exception) when (false) { }
              try { }
              catch (ArgumentException) when (false) { }
              catch (Exception) { }
              try { }
              catch (Exception) when (false) { }
              finally { }
              try { }
              catch (Exception e) when (e != null) { throw; }
              catch (Exception) { }
              catch (ArgumentException) when (true) { }
          }
      }
    `,
  ),
  diag(
    'cs0029-cs0103-filter-conditions',
    cs`
      using System;
      class Program
      {
          static void Main()
          {
              try { }
              catch (Exception e) when (1) { }
              try { }
              catch when (e2 == null) { }
              try { }
              catch (Exception e) when (e.Message) { }
          }
      }
    `,
  ),
  out(
    'filters-select-the-handler',
    cs`
      using System;
      class Program
      {
          static int F(bool b)
          {
              int x;
              try { if (b) throw new Exception("boom"); return 1; }
              catch (Exception e) when ((x = 2) > 0 && e.Message == "boom") { return x; }
          }
          static void Main()
          {
              try { throw new InvalidOperationException("a"); }
              catch (InvalidOperationException e) when (e.Message == "b") { Console.WriteLine("no"); }
              catch (InvalidOperationException e) when (e.Message == "a") { Console.WriteLine("yes " + e.Message); }
              Console.WriteLine(F(true) + F(false));
          }
      }
    `,
  ),
  out(
    'filters-without-observable-timing',
    cs`
      using System;
      class Program
      {
          static void Thrower(string message)
          {
              try { throw new Exception(message); }
              finally { Console.WriteLine("inner finally " + message); }
          }
          static string Classify(string message, int limit)
          {
              int attempts = 0;
              try
              {
                  attempts++;
                  Thrower(message);
                  return "no exception";
              }
              catch (Exception e) when (e.Message == "first") { return "first clause: " + e.Message; }
              catch (Exception e) when (attempts < limit && e.Message != "skip") { return "second clause: " + e.Message; }
              catch (Exception) when (limit == 0) { return "third clause"; }
              finally { Console.WriteLine("outer finally " + message); }
          }
          static void Main()
          {
              Console.WriteLine(Classify("first", 5));
              Console.WriteLine(Classify("other", 5));
              Console.WriteLine(Classify("skip", 0));
              try
              {
                  Console.WriteLine(Classify("skip", 3));
              }
              catch (Exception e) when (false) { Console.WriteLine("never " + e.Message); }
              catch (Exception e) { Console.WriteLine("passed every filter: " + e.Message); }
              bool flag = true;
              try { throw new Exception("last"); }
              catch when (!flag) { Console.WriteLine("not taken"); }
              catch (Exception e) when (flag) { Console.WriteLine("taken " + e.Message); }
          }
      }
    `,
  ),
]);

export const fixtures = [...nameofFixtures, ...usingStaticFixtures, ...filterFixtures];
