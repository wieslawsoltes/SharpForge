/**
 * Differential fixtures for C# 14 extension blocks (SF-A02-T83): instance and static extension methods and
 * properties, generic blocks, operators, lookup scopes and precedence, the implementation methods called by name;
 * CS9282, CS9283, CS9284, CS9285, CS9287, CS9290-CS9292, CS9295, CS9300-CS9304, CS9316, CS9317, CS9319, CS9326, CS9339,
 * CS9342, CS9347, CS0120, CS0176, CS0200, CS0558, CS1061, CS0117.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('extension-blocks', [
  out(
    'properties-methods-and-static-members',
    cs`
      using System;
      static class E
      {
          extension(string s)
          {
              public int Twice => s.Length * 2;
              public string Tag { get { return "<" + s + ">"; } }
              public string Rep(int n) { string r = ""; for (int i = 0; i < n; i++) r += s; return r; }
              public string Framed() => s.Tag + s.Twice;
              public static string Make() => "made";
          }
          extension(int)
          {
              public static int Zero => 0;
              public static int Twice(int x) { return x * 2; }
          }
          extension(int i)
          {
              public bool IsEven => i % 2 == 0;
              public int Squared => i * i;
              public int Plus(int other) => i + other.Squared;
          }
          extension(object o)
          {
              public string Text => "[" + o + "]";
              public bool IsNull => o == null;
          }
      }
      class Program
      {
          static void Main()
          {
              Console.WriteLine("abc".Twice);
              Console.WriteLine("x".Tag);
              Console.WriteLine("ab".Rep(2));
              Console.WriteLine("ab".Framed());
              Console.WriteLine(string.Make());
              Console.WriteLine(int.Zero);
              Console.WriteLine(int.Twice(4));
              Console.WriteLine(3.IsEven + " " + 4.Squared + " " + 2.Plus(3));
              Console.WriteLine(5.Text);
              string none = null; Console.WriteLine(none.IsNull);
              Console.WriteLine(E.Rep("q", 3));
              Console.WriteLine(E.get_Twice("abcd"));
              Console.WriteLine(E.Make() + E.get_Zero() + E.get_Squared(6) + E.Plus(1, 1));
          }
      }
    `,
  ),
  out(
    'generic-blocks',
    cs`
      using System;
      using System.Collections.Generic;
      class Box<T> { public T V; public int Hits; }
      static class E
      {
          extension<T>(Box<T> box)
          {
              public T Value { get { box.Hits++; return box.V; } set { box.V = value; } }
              public bool HasHits => box.Hits > 0;
              public U Map<U>(Func<T, U> f) { return f(box.V); }
              public IEnumerable<T> Repeat(int n) { for (int i = 0; i < n; i++) yield return box.V; }
              public Func<T> Getter() { return () => box.V; }
              public static Box<T> Of(T v) { return new Box<T> { V = v }; }
          }
          extension<T>(T[] items)
          {
              public T First0 => items[0];
              public int Size { get { return items.Length; } }
          }
      }
      class Program
      {
          static void Main()
          {
              var b = new Box<int>();
              b.Value = 10; Console.WriteLine(b.V);
              Console.WriteLine(b.HasHits + " " + b.Value + " " + b.HasHits);
              Console.WriteLine(b.Map(x => "v" + x));
              foreach (var x in b.Repeat(2)) Console.WriteLine(x);
              Console.WriteLine(Box<string>.Of("s").Value);
              Console.WriteLine(b.Getter()());
              int[] a = { 7, 8 }; Console.WriteLine(a.First0 + a.Size);
              Console.WriteLine(new[] { "s", "t" }.First0);
          }
      }
    `,
  ),
  out(
    'property-assignment-forms',
    cs`
      using System;
      class Box<T> { public T V; public int Reads; public int Writes; }
      static class E
      {
          extension<T>(Box<T> box)
          {
              public T Value { get { box.Reads++; return box.V; } set { box.Writes++; box.V = value; } }
          }
          extension(Box<int> box)
          {
              public static int Created { get { return Counter.Value; } set { Counter.Value = value; } }
          }
      }
      static class Counter { public static int Value; }
      class Program
      {
          static Box<int> Get(Box<int> b) { Console.WriteLine("get"); return b; }
          static void Main()
          {
              var b = new Box<int>();
              b.Value = 10; b.Value += 4; Console.WriteLine(b.Value);
              b.Value++; ++b.Value; Console.WriteLine(b.V + " " + b.Reads + " " + b.Writes);
              Console.WriteLine(b.Value++ + " " + b.V);
              Get(b).Value *= 2; Console.WriteLine(b.V);
              var s = new Box<string>(); s.Value ??= "a"; s.Value ??= "unused"; s.Value += "b"; Console.WriteLine(s.Value);
              Console.WriteLine(s?.Value);
              Box<int>.Created = 3; Box<int>.Created += 2; Box<int>.Created++; Console.WriteLine(Box<int>.Created);
              var made = new Box<int> { Value = 5 }; Console.WriteLine(made.V);
          }
      }
    `,
  ),
  out(
    'operators',
    cs`
      using System;
      class Money { public int Cents; public Money(int c) { Cents = c; } }
      class Pair<T> { public T A; public T B; }
      static class E
      {
          extension(Money m)
          {
              public static Money operator +(Money a, Money b) => new Money(a.Cents + b.Cents);
              public static Money operator *(Money a, int k) => new Money(a.Cents * k);
              public static Money operator -(Money a) => new Money(-a.Cents);
              public static bool operator ==(Money a, Money b) => a.Cents == b.Cents;
              public static bool operator !=(Money a, Money b) => a.Cents != b.Cents;
              public static Money operator ++(Money a) => new Money(a.Cents + 1);
              public static bool operator <(Money a, Money b) => a.Cents < b.Cents;
              public static bool operator >(Money a, Money b) => a.Cents > b.Cents;
          }
          extension<T>(Pair<T> p)
          {
              public static Pair<T> operator !(Pair<T> x) => new Pair<T> { A = x.B, B = x.A };
          }
          extension(int)
          {
              public static int operator +(int a, int b) => 100;
          }
      }
      class Program
      {
          static void Main()
          {
              var a = new Money(5); var b = new Money(7);
              Console.WriteLine((a + b).Cents);
              Console.WriteLine((a * 3).Cents);
              Console.WriteLine((-a).Cents);
              Console.WriteLine(a == b);
              Console.WriteLine(a != b);
              Console.WriteLine(a < b);
              a += b; Console.WriteLine(a.Cents);
              a++; Console.WriteLine(a.Cents);
              var c = ++a; Console.WriteLine(c.Cents);
              a *= 2; Console.WriteLine(a.Cents);
              var p = !new Pair<string> { A = "x", B = "y" }; Console.WriteLine(p.A + p.B);
              Console.WriteLine(1 + 2);
              Console.WriteLine(E.op_Addition(new Money(1), new Money(2)).Cents);
          }
      }
    `,
  ),
  out(
    'scopes-and-precedence',
    cs`
      using System;
      using Lib;
      namespace Lib
      {
          class Item { public string Name = "item"; public int Size => 1; }
          static class ItemExtensions
          {
              extension(Item item)
              {
                  public int Size => 99;
                  public string Label => "lib:" + item.Name;
                  public string Describe() { return "lib " + item.Label; }
                  public static Item Default => new Item { Name = "default" };
              }
              extension(object o) { public string Kind => "object"; }
              extension(string s) { public string Kind => "string"; }
          }
      }
      namespace App
      {
          static class Local
          {
              extension(Item item) { public string Label => "app:" + item.Name; }
          }
          class Program
          {
              static void Main()
              {
                  var item = new Item();
                  Console.WriteLine(item.Size);
                  Console.WriteLine(item.Label);
                  Console.WriteLine(item.Describe());
                  Console.WriteLine(Item.Default.Name);
                  Console.WriteLine("s".Kind + " " + item.Kind + " " + 1.Kind);
              }
          }
      }
    `,
  ),
  diag(
    'cs9282-cs9302-cs9304-cs9326-cs9347-members',
    cs`
      static class E
      {
          extension(string s)
          {
              public int Auto { get; set; }
              class Nested { }
              protected int Prot => 1;
              public int Init { get => 1; init { } }
              public int String => 1;
              public static int Bad => s.Length;
              public static int BadM() { return s.Length; }
              public int Fine => s.Length;
          }
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs9283-container',
    cs`
      class NotStatic { extension(string s) { public int A => 1; } }
      static class Generic<T> { extension(string s) { public int B => 1; } }
      static class Outer { static class Inner { extension(string s) { public int C => 1; } } }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs9303-cs9285-cs9295-cs9287-cs9300-receiver',
    cs`
      static class E
      {
          extension(int) { public int Inst => 1; public void M() { } public static int Ok => 2; }
          extension(string a, string b) { public int Two => 1; }
          extension<T>(string s) { public int Under => 1; public void UnderM() { } public void Fine(T t) { } }
          extension<T>(T T) { public int Same => 1; }
          extension<U>(U[] value) { public int Val { get => 1; set { } } }
          extension(string s) { public void P(int s) { } public void G<s>() { } }
          extension(ref string r) { public int Ref => 1; }
          extension(ref int ri) { public int RefOk => ri; }
          extension(in string ins) { public int In => 1; }
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs9339-cs0176-cs0120-cs9316-cs0200-uses',
    cs`
      using System;
      static class E
      {
          extension(string s) { public int Twice => s.Length * 2; public static int Zero => 0; }
          extension(object o) { public int Twice => 1; }
      }
      static class F { extension(string s) { public int Amb => 1; } }
      static class G { extension(string s) { public int Amb => 2; } }
      class Program
      {
          static void Main()
          {
              Console.WriteLine("a".Twice);
              Console.WriteLine("a".Amb);
              Console.WriteLine("a".Missing);
              Console.WriteLine(string.Twice);
              Console.WriteLine("a".Zero);
              Console.WriteLine(nameof(string.Zero));
              Console.WriteLine(1.Twice);
              "a".Twice = 3;
          }
      }
    `,
  ),
  diag(
    'cs1061-cs0117-not-in-scope',
    cs`
      using System;
      namespace Lib
      {
          class Item { }
          static class ItemExtensions
          {
              extension(Item item) { public string Label => "x"; public void Run() { } public static int Count => 0; }
          }
      }
      class Program
      {
          static void Main()
          {
              var item = new Lib.Item();
              Console.WriteLine(item.Label);
              item.Run();
              Console.WriteLine(Lib.Item.Count);
          }
      }
    `,
  ),
  diag(
    'cs9319-cs9317-cs0558-cs9342-operators',
    cs`
      class Money { public int Cents; }
      static class E
      {
          extension(Money m)
          {
              public static int operator +(int a, int b) => 100;
              public static int operator -(int a) => 100;
              static Money operator *(Money a, Money b) => a;
              public Money operator /(Money a, Money b) => a;
          }
      }
      static class F { extension(Money m) { public static Money operator %(Money a, Money b) => a; } }
      static class G { extension(Money m) { public static Money operator %(Money a, Money b) => b; } }
      class Program
      {
          static void Main()
          {
              var a = new Money();
              var b = a % a;
              var c = a ^ a;
          }
      }
    `,
  ),
  diag(
    'cs9284-cs9285-receiver-default-value',
    cs`
      static class E
      {
          extension(int x = 0) { public int Plain => x; }
          extension(string s = null, int extra = 1) { public int Two => 1; }
          extension(int = 5) { public static int Unnamed => 1; }
      }
      class Program { static void Main() { } }
    `,
  ),
]);
