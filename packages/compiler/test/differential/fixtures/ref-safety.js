/**
 * Differential fixtures for ref safety (SF-A02-T04.6): safe-to-escape and ref-safe-to-escape contexts under the
 * C# 11 rules, `scoped` and `[UnscopedRef]`. Diagnostics fixtures pin CS8350-CS8353, CS8347, CS8374, CS9079, the
 * ref-return family CS8156/CS8157/CS8166-CS8170 and CS9075-CS9077; output fixtures are valid programs that must
 * stay free of errors.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('ref-safety', [
  diag(
    'cs8352-return-stackalloc-local',
    cs`
      using System;
      static class C
      {
          static Span<int> Make() { Span<int> s = stackalloc int[4]; return s; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8353-return-stackalloc',
    cs`
      using System;
      static class C
      {
          static Span<int> Make() { return stackalloc int[4]; }
          static Span<int> Short() => stackalloc int[] { 1, 2 };
          static void Keep(ref Span<int> target) { target = stackalloc int[2]; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8350-argument-mixing',
    cs`
      using System;
      ref struct R { public Span<int> F; }
      static class C
      {
          static void Mix(ref R a, Span<int> b) { }
          static void Use(ref R r) { Span<int> local = stackalloc int[2]; Mix(ref r, local); }
          static void Fine(ref R r, Span<int> wide) { Mix(ref r, wide); }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8351-ref-conditional-mixed-scopes',
    cs`
      using System;
      static class C
      {
          static void T(ref Span<int> outer, bool b)
          {
              Span<int> inner = stackalloc int[1];
              ref Span<int> q = ref (b ? ref outer : ref inner);
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8352-assign-to-wider-variable',
    cs`
      using System;
      static class C
      {
          static void ToRef(ref Span<int> dest) { Span<int> s = stackalloc int[1]; dest = s; }
          static void ToOut(out Span<int> o) { Span<int> s = stackalloc int[1]; o = s; }
          static void ToOuter() { Span<int> wide = default; { Span<int> narrow = stackalloc int[1]; wide = narrow; } }
          static void Scoped() { Span<int> a = default; { scoped Span<int> b = default; a = b; } }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8352-conditional-and-slice',
    cs`
      using System;
      static class C
      {
          static Span<int> Slice() { Span<int> s = stackalloc int[4]; return s.Slice(1); }
          static Span<int> Cond(bool b, Span<int> p) { Span<int> s = stackalloc int[4]; return b ? p : s; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8347-call-exposes-argument',
    cs`
      using System;
      ref struct R
      {
          public ref int P;
          public R(ref int p) { P = ref p; }
      }
      static class C
      {
          static Span<int> Id(Span<int> s) => s;
          static Span<int> Call() { Span<int> s = stackalloc int[1]; return Id(s); }
          static R Make() { int v = 0; return new R(ref v); }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8156-in-argument-temporary',
    cs`
      using System;
      static class C
      {
          static Span<int> Get(in int n) => new int[n];
          static Span<int> Constant() { return Get(5); }
          static Span<int> Parameter(int k) { return Get(k); }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8166-cs8167-parameter-by-reference',
    cs`
      struct S { public int X; }
      static class C
      {
          static ref int P(int p) { return ref p; }
          static ref int PF(S s) { return ref s.X; }
          static ref int Fine(ref int x) => ref x;
          static ref int FineField(ref S s) => ref s.X;
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8168-cs8169-local-by-reference',
    cs`
      struct S { public int X; }
      static class C
      {
          static ref int L() { int x = 0; return ref x; }
          static ref int LF() { S s = default; return ref s.X; }
          static ref int Element(int[] a) { return ref a[0]; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8170-struct-this',
    cs`
      using System.Diagnostics.CodeAnalysis;
      struct S
      {
          public int X;
          public ref int Bad() => ref X;
          public ref int Worse() { return ref this.X; }
          [UnscopedRef] public ref int Ok() => ref X;
      }
      static class C
      {
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8157-ref-local-not-returnable',
    cs`
      static class C
      {
          static ref int Element(int[] arr) { ref int r = ref arr[0]; return ref r; }
          static ref int Local() { int x = 0; ref int r = ref x; return ref r; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8374-ref-assign-narrower',
    cs`
      static class C
      {
          static void Reassign() { int x = 0; ref int r = ref x; { int y = 1; r = ref y; } r++; }
          static void Fine() { int x = 0, y = 1; ref int r = ref x; r = ref y; r++; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs9075-cs9076-scoped-parameter',
    cs`
      struct S { public int X; }
      static class C
      {
          static ref int Scoped(scoped ref int x) => ref x;
          static ref int ScopedField(scoped ref S s) => ref s.X;
          static ref int Out(out int o) { o = 1; return ref o; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs9077-ref-parameter-through-ref-parameter',
    cs`
      ref struct R
      {
          public ref int P;
          public R(ref int p) { P = ref p; }
      }
      static class C
      {
          static void Through(ref R r, ref int x) { r = new R(ref x); }
          static R Returned(ref int x) { return new R(ref x); }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs9079-ref-assign-return-only',
    cs`
      ref struct R
      {
          public ref int P;
          public R(ref int p) { P = ref p; }
          public void Set(ref int q) { P = ref q; }
      }
      static class C
      {
          static void Through(ref R r, ref int x) { r.P = ref x; }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8168-unscoped-ref-receiver',
    cs`
      using System.Diagnostics.CodeAnalysis;
      struct S
      {
          public int X;
          [UnscopedRef] public ref int Slot() => ref X;
          [UnscopedRef] public ref int Prop => ref X;
      }
      static class C
      {
          static ref int Local() { S s = default; return ref s.Slot(); }
          static ref int Parameter(ref S s) { return ref s.Slot(); }
          static ref int Property(ref S s) => ref s.Prop;
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8166-local-function',
    cs`
      static class C
      {
          static void Outer()
          {
              static ref int Bad(int q) => ref q;
              static ref int Good(ref int q) => ref q;
              int v = 0;
              Good(ref v) = Bad(1);
          }
          static void Main() { }
      }
    `,
  ),
  out(
    'valid-spans-and-ref-returns',
    cs`
      using System;
      using System.Diagnostics.CodeAnalysis;

      ref struct Window
      {
          public Span<int> Items;
          public ref int First;
          public Window(Span<int> items) { Items = items; First = ref items[0]; }
          public Span<int> Tail() => Items.Slice(1);
          public ref int At(int i) => ref Items[i];
          public Window Shrink() { return new Window(Items.Slice(1)); }
          public void Replace(Span<int> other) { Items = other; }
      }
      struct Counter
      {
          public int Value;
          [UnscopedRef] public ref int Slot => ref Value;
          public int Next() { Value++; return Value; }
      }
      class Holder
      {
          int[] data = new int[4];
          int single;
          public Span<int> All => data;
          public ref int Single => ref single;
          public ref int At(int i) => ref data[i];
          public Span<int> Part(int n) { Span<int> s = data; return s.Slice(n); }
      }
      static class Program
      {
          static Span<int> Pick(Span<int> a, Span<int> b, bool first) => first ? a : b;
          static ref int Max(ref int a, ref int b) { if (a > b) return ref a; return ref b; }
          static ref int Choose(bool c, ref int a, ref int b) => ref (c ? ref a : ref b);
          static void Fill(scoped Span<int> target, int v) { for (int i = 0; i < target.Length; i++) target[i] = v; }
          static int Total(scoped ref Window w) { int t = 0; for (int i = 0; i < w.Items.Length; i++) t += w.Items[i]; return t; }
          static void Swap(ref Span<int> a, ref Span<int> b) { Span<int> t = a; a = b; b = t; }
          static bool TryTake(Span<int> source, out Span<int> rest) { rest = source.Slice(1); return true; }
          static Span<int> Whole(int[] array) { Span<int> s = array; return s; }
          static ReadOnlySpan<int> Read(int[] array) { ReadOnlySpan<int> s = array; return s.Slice(1); }
          static int Local()
          {
              Span<int> buffer = stackalloc int[4];
              Fill(buffer, 3);
              var w = new Window(buffer);
              Span<int> other = stackalloc int[] { 1, 2 };
              w.Replace(other);
              Span<int> x = buffer, y = other;
              Swap(ref x, ref y);
              if (TryTake(buffer, out var rest)) x = rest;
              ref int m = ref Max(ref buffer[0], ref buffer[1]);
              m = 9;
              Counter c = default;
              ref int slot = ref c.Slot;
              slot = 5;
              scoped ref int sr = ref slot;
              sr++;
              return Total(ref w) + w.Tail().Length + w.At(0) + x.Length + y.Length + c.Next() + Pick(buffer, other, true)[0];
          }
          static void Main()
          {
              var h = new Holder();
              h.At(1) = 7; h.Single = 3;
              int a = 1, b = 2;
              Choose(true, ref a, ref b) = 10;
              Console.WriteLine(Local() + " " + h.All.Length + " " + h.Part(1).Length + " " + a);
              Console.WriteLine(Whole(new int[3]).Length + " " + Read(new int[3]).Length + " " + h.Single);
          }
      }
    `,
  ),
  out(
    'valid-heap-backed-spans-escape',
    cs`
      using System;
      ref struct Pair
      {
          public Span<int> Left;
          public Span<int> Right;
          public Pair(Span<int> left, Span<int> right) { Left = left; Right = right; }
      }
      static class Program
      {
          static Span<int> Fresh(int n) { Span<int> s = new int[n]; return s; }
          static Pair Split(int[] array) { Span<int> all = array; return new Pair(all.Slice(0, 1), all.Slice(1)); }
          static Span<int> Either(bool first, Span<int> a) { Span<int> b = new int[2]; return first ? a : b; }
          static void Store(ref Span<int> target, int[] source) { Span<int> s = source; target = s; }
          static void Main()
          {
              Span<int> kept = default;
              Store(ref kept, new int[5]);
              Pair p = Split(new int[4]);
              Console.WriteLine(Fresh(3).Length + " " + p.Left.Length + p.Right.Length + " " + Either(false, kept).Length + " " + kept.Length);
          }
      }
    `,
  ),
  out(
    'valid-ref-locals-and-scopes',
    cs`
      using System;
      struct Point { public int X, Y; }
      class Grid
      {
          Point[] cells = new Point[3];
          public ref Point Cell(int i) => ref cells[i];
          public ref int X(int i) { ref Point p = ref cells[i]; return ref p.X; }
      }
      static class Program
      {
          static ref int Pick(ref Point p, bool x) { if (x) return ref p.X; return ref p.Y; }
          static void Main()
          {
              var g = new Grid();
              g.Cell(0).X = 4;
              g.X(1) = 5;
              Point local = default;
              ref int r = ref Pick(ref local, true);
              r = 6;
              {
                  int inner = 1;
                  ref int q = ref inner;
                  q += local.X;
                  r = ref local.Y;
                  r = q;
              }
              Console.WriteLine(g.Cell(0).X + " " + g.Cell(1).X + " " + local.X + " " + local.Y);
          }
      }
    `,
  ),
]);
