/**
 * Differential fixtures for members as tracked variables of the nullable analysis (SF-A02-T05.4): a null test or an
 * assignment of `x.Next`, `x.Next.Name`, a static member or a property refines later reads of the same member path;
 * assigning the receiver forgets or copies its members; a method call does not change them. CS8605 (unboxing a
 * possibly null value) is pinned here too.
 */
import { cs, diag, feature } from './kit.js';

const node = `
  class N
  {
      public string? S; public N? Next; public int V; public string Name = "";
      public string? P { get; set; }
      public string? Q => S;
      public N? Other() => Next;
      public void Reset() { S = null; }
      public static N? Shared;
  }`;

export const fixtures = feature('nullable-member-slots', [
  diag(
    'null-tests-of-members',
    cs`
      #nullable enable
      ${node}
      class Own
      {
          string? S; N? Next;
          void Members(N other)
          {
              if (Next != null) { int a = Next.V; }
              if (this.S != null) { int a = this.S.Length; }
              if (other.S != null) { int a = other.S.Length; }
              if (Next?.S != null) { int a = Next.S.Length; }
              int b = Next.V;
          }
      }
      static class P
      {
          static N? field;
          static string? Text { get; set; }
          static void Members(N x, N? y)
          {
              if (x.Next != null) { int a = x.Next.V; }
              if (x.S != null) { int a = x.S.Length; x = new N(); int b = x.S.Length; }
              if (x.P != null) { int a = x.P.Length; }
              if (x.Q != null) { int a = x.Q.Length; }
              if (x.Next != null && x.Next.S != null) { int a = x.Next.S.Length; }
              if (x.Next?.S != null) { int a = x.Next.S.Length; }
              if (y?.Next?.S != null) { int a = y.Next.S.Length; }
              if (x.Other() != null) { int a = x.Other().V; }
          }
          static void Statics()
          {
              if (field != null) { int a = field.V; }
              if (Text != null) { int a = Text.Length; }
              if (field?.S != null) { int a = field.S.Length; }
              string s = Text;
              field = null;
              int b = field.V;
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'assignments-and-copies',
    cs`
      #nullable enable
      ${node}
      static class P
      {
          static void Assignments(N x, N y)
          {
              x.S = "a";
              y.S = null;
              int a = x.S.Length + y.S.Length;
              x = y;
              int b = x.S.Length;
              x.Next = y;
              x.Next.S = "q";
              int c = x.Next.S.Length;
              x.Next = null;
              int d = x.Next.S.Length;
          }
          static void Chained(N? x)
          {
              int d = x.S.Length;
          }
          static void OutAndRef(N x)
          {
              if (x.S == null) return;
              Fill(out x.S);
              int a = x.S.Length;
              x.S = "t";
              Change(ref x.S);
              int b = x.S.Length;
              Make(out x);
              int c = x.S.Length;
          }
          static void Fill(out string? s) { s = null; }
          static void Change(ref string? s) { s = null; }
          static void Make(out N n) { n = new N(); }
          static void Main() { }
      }
    `,
  ),
  diag(
    'calls-loops-and-lambdas',
    cs`
      #nullable enable
      using System;
      ${node}
      static class P
      {
          static void Calls(N x)
          {
              if (x.S == null) return;
              int a = x.S.Length;
              Touch(x);
              int b = x.S.Length;
              x.Reset();
              int c = x.S.Length;
              N.Shared = new N();
              N.Shared.S = "a";
              int d = N.Shared.S.Length;
              x.P ??= "e";
              int e = x.P.Length;
          }
          static void Loops(N? head)
          {
              for (N? n = head; n != null; n = n.Next)
              {
                  if (n.S == null) continue;
                  int a = n.S.Length;
              }
              N cur = new N();
              while (cur.Next != null) { cur = cur.Next; int b = cur.S.Length; }
              int after = cur.Next.V;
              cur.S = "z";
              do { int e = cur.S.Length; cur.S = null; } while (cur.Name.Length > 0);
          }
          static void Lambdas(N x)
          {
              if (x.S == null) return;
              Func<int> f = () => x.S.Length;
              x.S = null;
              Func<int> g = () => x.S.Length;
          }
          static void Touch(N n) { }
          static void Main() { }
      }
    `,
  ),
  diag(
    'structs-and-property-patterns',
    cs`
      #nullable enable
      ${node}
      struct V { public string? T; public N? Inner; }
      static class P
      {
          static void Structs(V v, V[] many)
          {
              if (v.T != null) { int a = v.T.Length; }
              int b = v.T.Length;
              if (v.Inner?.S != null) { int c = v.Inner.S.Length; }
              if (many[0].T != null) { int d = many[0].T.Length; }
          }
          static void Patterns(N x)
          {
              if (x.Next is { S: not null }) { int e = x.Next.S.Length; }
              if (x.Next is { S: null }) { int f = x.Next.S.Length; }
              if (x.Next is N m && m.S != null) { int g = m.S.Length; }
              if (x is { Next: { S: not null } }) { int h = x.Next.S.Length; }
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8605-unboxing-possible-null',
    cs`
      #nullable enable
      static class P
      {
          static object? Maybe(bool b) { if (b) return 1; return null; }
          static void Unbox(object? o, object p, bool b)
          {
              int a = (int)o;
              int c = (int)p;
              int d = (int)Maybe(b);
              if (o != null) { int e = (int)o; }
              int? f = (int?)Maybe(b);
              int i = (int)(o ?? 1);
              int k = (int)Maybe(b)!;
              object? q = null;
              int j = (int)q;
          }
          static void Main() { }
      }
    `,
  ),
]);
