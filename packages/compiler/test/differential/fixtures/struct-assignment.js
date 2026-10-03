/**
 * Differential fixtures for definite assignment of struct fields (SF-A02-T34): before C# 11 a struct constructor
 * must assign every field (CS0171), every auto-property (CS0843) and may not read them or use `this` earlier
 * (CS9015, CS9014, CS0188); from C# 11 the compiler defaults what is left unassigned, so the same constructors are
 * valid. Struct locals assigned field by field are covered at every nesting depth (CS0170).
 */
import { cs, out, diag, feature } from './kit.js';

const csharp10 = { langVersion: '10' };

const constructors = cs`
  using System;
  struct Point
  {
      public int X;
      public int Y;
      public Point(int x) { X = x; }
  }
  struct Size
  {
      public int Width { get; }
      public int Height { get; set; }
      public Size(int width) { Width = width; }
  }
  struct Early
  {
      public int X;
      public string Name;
      public Early(bool early) { if (early) return; X = 1; Name = "n"; }
  }
  struct Reader
  {
      public int X;
      public int Y { get; set; }
      public Reader(int x) { Y = X + Y; X = x; }
  }
  struct Caller
  {
      public int X;
      public int Twice => X * 2;
      public Caller(int x) { Show(); X = x; }
      public Caller(bool b) { X = Twice; }
      void Show() { }
  }
  static class Program
  {
      static void Main()
      {
          var p = new Point(1);
          var s = new Size(2);
          var e = new Early(true);
          var r = new Reader(3);
          var c = new Caller(4);
          Console.WriteLine(p.X + p.Y + " " + s.Width + s.Height + " " + e.X + (e.Name ?? "-") + " " + r.X + r.Y + " " + c.Twice);
      }
  }
`;

export const fixtures = feature('struct-assignment', [
  diag('cs0171-cs0843-constructors-csharp-10', constructors, csharp10),
  out('auto-default-constructors-csharp-11', constructors),
  diag(
    'cs0171-branches-and-loops-csharp-10',
    cs`
      struct Branch
      {
          int x, y;
          public Branch(bool b) { if (b) x = 1; else y = 2; }
          public int Sum() => x + y;
      }
      struct Loop
      {
          public int X;
          public string S;
          public Loop(int n)
          {
              while (n-- > 0) { X = n; }
              S = X.ToString();
          }
      }
      struct Twice
      {
          public int X;
          public int W;
          public Twice(bool b)
          {
              System.Console.WriteLine(X);
              System.Console.WriteLine(X);
              if (b) { W = 1; return; }
              X = 2;
          }
      }
      static class Program { static void Main() { } }
    `,
    csharp10,
  ),
  diag(
    'cs0188-this-before-assignment-csharp-10',
    cs`
      struct Passed
      {
          public int X;
          public Passed(int x) { Use(this); X = x; }
          static void Use(Passed p) { }
      }
      struct Copied
      {
          public int X;
          public int Y;
          public Copied(int x) { X = x; var copy = this; Y = copy.X; }
      }
      static class Program { static void Main() { } }
    `,
    csharp10,
  ),
  diag(
    'cs0171-nested-struct-field-csharp-10',
    cs`
      struct Inner { public int X, Y; }
      struct Partial
      {
          public Inner Inner;
          public int Z;
          public Partial(int z) { Inner.X = z; Z = z; }
      }
      struct Complete
      {
          public Inner Inner;
          public int Z;
          public Complete(int z) { Inner.X = z; Inner.Y = z; Z = Inner.X; }
      }
      static class Program { static void Main() { } }
    `,
    csharp10,
  ),
  out(
    'valid-struct-constructors-csharp-10',
    cs`
      using System;
      struct Inner { public int X, Y; }
      struct Chained
      {
          public int X;
          public int Y;
          public Chained(int x) : this() { X = x; }
          public Chained(int x, int y) { this = new Chained(x); Y = y; }
      }
      struct Initialized
      {
          public int X;
          public int Y = 5;
          public static int Count = 1;
          public Initialized(int x) { X = x; }
      }
      struct ByOut
      {
          public int X;
          public Inner Pair;
          public ByOut(int x) { Set(out X); Pair.X = x; Pair.Y = X; }
          static void Set(out int v) { v = 7; }
      }
      struct Guarded
      {
          int value;
          public Guarded(int v) { try { value = v; } finally { } }
          public int Get() => value;
      }
      static class Program
      {
          static void Main()
          {
              var c = new Chained(1, 2);
              var i = new Initialized(3);
              var o = new ByOut(4);
              Console.WriteLine(c.X + c.Y + " " + i.X + i.Y + " " + o.X + o.Pair.X + o.Pair.Y + " " + new Guarded(9).Get());
          }
      }
    `,
    csharp10,
  ),
  diag(
    'cs0170-nested-struct-local',
    cs`
      using System;
      struct Inner { public int X, Y; }
      struct Outer { public Inner Inner; public int Z; }
      static class Program
      {
          static void Main()
          {
              Outer whole;
              whole.Inner.X = 1; whole.Inner.Y = 2; whole.Z = 3;
              Outer copy = whole;
              Outer partial;
              partial.Inner.X = 1;
              Console.WriteLine(partial.Inner.Y + copy.Z);
              Outer other;
              other.Z = 1;
              Inner inner = other.Inner;
              Console.WriteLine(inner.X);
          }
      }
    `,
  ),
  out(
    'valid-nested-struct-local',
    cs`
      using System;
      struct Inner { public int X, Y; }
      struct Outer { public Inner Inner; public int Z; }
      static class Program
      {
          static int Sum(Outer o) => o.Inner.X + o.Inner.Y + o.Z;
          static void Main()
          {
              Outer whole;
              whole.Inner.X = 1; whole.Inner.Y = 2; whole.Z = 3;
              Outer second;
              second.Inner = whole.Inner;
              second.Z = whole.Inner.X + 10;
              Console.WriteLine(Sum(whole) + " " + Sum(second));
          }
      }
    `,
  ),
]);
