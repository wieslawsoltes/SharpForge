/**
 * Differential fixtures for the null-state after a test of a conditional access (SF-A02-T05.4): a comparison, a
 * pattern or a `??` that can only succeed when `a?.b` produced a value proves `a` not null on that branch, and CS8602
 * is expected on the other one. Chains (`a?.b?.c`) and the short-circuit operators are covered as well.
 */
import { cs, diag, feature } from './kit.js';

const node = `
  class N
  {
      public bool B; public string? S; public N? Next; public int V;
      public bool Has() => B;
      public int Count() => V;
  }`;

export const fixtures = feature('nullable-conditional-access', [
  diag(
    'relational-and-equality-comparisons',
    cs`
      #nullable enable
      static class P
      {
          static void Relational(string? k)
          {
              if (k?.Length > 0) { int n = k.Length; } else { int m = k.Length; }
              if (k?.Length >= 0) { int n = k.Length; }
              if (k?.Length < 5) { int n = k.Length; }
              if (0 < k?.Length) { int n = k.Length; }
          }
          static void Equality(string? k, int other)
          {
              if (k?.Length == 3) { int n = k.Length; } else { int m = k.Length; }
              if (k?.Length != 3) { int n = k.Length; } else { int m = k.Length; }
              if (k?.Length == other) { int n = k.Length; }
              if (3 == k?.Length) { int n = k.Length; }
          }
          static void NullTests(string? k)
          {
              if (k?.Length != null) { int n = k.Length; } else { int m = k.Length; }
              if (k?.Length == null) { int n = k.Length; } else { int m = k.Length; }
              if (k?.ToString() != null) { int n = k.Length; }
              if (null != k?.ToString()) { int n = k.Length; }
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'boolean-members-and-coalesce',
    cs`
      #nullable enable
      ${node}
      static class P
      {
          static void Booleans(N? x)
          {
              if (x?.B == true) { bool b = x.B; } else { bool c = x.B; }
              if (x?.B == false) { bool b = x.B; }
              if (x?.B != true) { bool b = x.B; } else { bool c = x.B; }
              if (x?.Has() == true) { bool b = x.B; }
          }
          static void Coalesce(N? x)
          {
              if (x?.B ?? false) { bool b = x.B; } else { bool c = x.B; }
              if (x?.B ?? true) { bool b = x.B; } else { bool c = x.B; }
              if (!(x?.B ?? true)) { bool b = x.B; }
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'patterns',
    cs`
      #nullable enable
      ${node}
      static class P
      {
          static void Patterns(N? x)
          {
              if (x?.S is string s) { bool b = x.B; } else { bool c = x.B; }
              if (x?.S is not null) { bool b = x.B; } else { bool c = x.B; }
              if (x?.S is null) { bool b = x.B; } else { bool c = x.B; }
              if (x?.V is 3) { bool b = x.B; }
              if (x?.V is > 3) { bool b = x.B; }
              if (x?.S is { Length: 3 }) { bool b = x.B; }
              if (x?.V is int v) { bool b = x.B; }
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'chains-and-short-circuits',
    cs`
      #nullable enable
      ${node}
      static class P
      {
          static void Chains(N? x)
          {
              if (x?.Next?.S != null) { bool b = x.B; N n = x.Next; int l = x.Next.S.Length; }
              if (x?.Next?.V > 0) { bool b = x.B; }
              if (x?.Next?.Count() == 1) { bool b = x.B; }
              if (x?.S?.Length > 0 && x.B) { }
              if (x?.S == null || x.B) { }
              bool r = x?.V > 0 && x.B;
              int t = x?.V > 0 ? x.V : 0;
              while (x?.V > 0) { x = x.Next; }
              bool after = x.B;
          }
          static void AsValue(N? x, N y)
          {
              int? v = x?.V;
              bool b = x.B;
              int? w = y?.V;
              bool c = y.B;
          }
          static void Main() { }
      }
    `,
  ),
]);
