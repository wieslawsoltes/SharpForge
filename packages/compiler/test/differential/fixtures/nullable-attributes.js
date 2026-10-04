/**
 * Differential fixtures for the nullable analysis attributes (SF-A02-T05.5, System.Diagnostics.CodeAnalysis):
 * postconditions of arguments (NotNull, MaybeNull, NotNullWhen, MaybeNullWhen), of results (NotNullIfNotNull,
 * MaybeNull, NotNull) and of members (MemberNotNull, MemberNotNullWhen), preconditions (AllowNull, DisallowNull) and
 * reachability (DoesNotReturn, DoesNotReturnIf).
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = feature('nullable-attributes', [
  diag(
    'argument-postconditions',
    cs`
      #nullable enable
      using System;
      using System.Diagnostics.CodeAnalysis;
      static class P
      {
          static bool Try([NotNullWhen(true)] out string? s) { s = "a"; return true; }
          static bool TryNot([NotNullWhen(false)] out string? s) { s = "a"; return false; }
          static bool Find(string key, [MaybeNullWhen(false)] out string value) { value = key; return true; }
          static void Ensure([NotNull] string? s) { if (s == null) throw new Exception(); }
          static void Loosen([MaybeNull] ref string s) { }
          static bool IsNull([NotNullWhen(false)] string? s) => s == null;

          static void Conditional()
          {
              string? s;
              if (Try(out s)) { int a = s.Length; } else { int b = s.Length; }
              if (!TryNot(out var t)) { int a = t.Length; } else { int b = t.Length; }
              if (Find("k", out string v)) { int a = v.Length; } else { int b = v.Length; }
              if (Find("k", out var w) && w.Length > 0) { }
              bool ok = Try(out var u);
              int c = u.Length;
          }
          static void Unconditional(string? p, string? q, string r)
          {
              Ensure(p);
              int a = p.Length;
              Loosen(ref r);
              int b = r.Length;
              if (IsNull(q)) return;
              int c = q.Length;
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'result-postconditions',
    cs`
      #nullable enable
      using System.Diagnostics.CodeAnalysis;
      static class P
      {
          [return: NotNullIfNotNull("x")] static string? Id(string? x) => x;
          [return: NotNullIfNotNull(nameof(a))]
          [return: NotNullIfNotNull(nameof(b))]
          static string? Either(string? a, string? b) => a ?? b;
          [return: MaybeNull] static string Default() => null!;
          [return: NotNull] static string? Always() => "a";

          static void Returns(string? n)
          {
              string a = Id("a");
              string b = Id(n);
              string c = Either(n, "b");
              string d = Either(n, n);
              string e = Default();
              string f = Always();
              string g = Id(null);
              int h = Id("a").Length + Id(n).Length;
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'member-postconditions',
    cs`
      #nullable enable
      using System.Diagnostics.CodeAnalysis;
      class Box
      {
          public string? Name;
          public string? Other;
          [MemberNotNull(nameof(Name))] public void Init() { Name = "a"; }
          [MemberNotNull(nameof(Name), nameof(Other))] public void InitBoth() { Name = "a"; Other = "b"; }
          [MemberNotNullWhen(true, nameof(Name))] public bool Has => Name != null;
          [MemberNotNullWhen(false, "Name")] public bool Missing() => Name == null;
          [MemberNotNull(nameof(Name))] public int Count { get { Name = "a"; return 1; } }
          void Own()
          {
              Init();
              int a = Name.Length;
          }
          void OwnTests()
          {
              if (Has) { int a = Name.Length; } else { int b = Name.Length; }
              if (!Missing()) { int c = Name.Length; }
              int d = Name.Length;
          }
      }
      static class P
      {
          static void Receivers(Box box, Box? maybe)
          {
              int z = box.Name.Length;
              box.Name = null;
              box.Init();
              int a = box.Name.Length;
              box.Name = null;
              if (box.Has) { int b = box.Name.Length; } else { int c = box.Name.Length; }
              box.Name = null;
              if (!box.Missing() && box.Name.Length > 0) { }
              box.Name = null;
              int n = box.Count;
              int d = box.Name.Length;
              box.InitBoth();
              int e = box.Other.Length;
              if (maybe?.Has == true) { int f = maybe.Name.Length; }
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'preconditions',
    cs`
      #nullable enable
      using System.Diagnostics.CodeAnalysis;
      class Box
      {
          [AllowNull] public string Text { get => text; set => text = value ?? ""; }
          string text = "";
          [DisallowNull] public string? Tag { get; set; }
          [MaybeNull] public string Loose = "";
          [NotNull] public string? Tight = "x";
      }
      static class P
      {
          static void M(string a, [AllowNull] string b, [DisallowNull] string? c, string? d) { }
          static void Callers(Box box, string? n)
          {
              M(null, null, null, null);
              M("a", n, n, n);
              box.Text = null;
              box.Tag = null;
              box.Tag = n;
              string x = box.Text;
              string y = box.Loose;
              string z = box.Tight;
              string t = box.Tag;
          }
          static void Bodies(string a, [AllowNull] string b, [DisallowNull] string? c, [NotNull] string? d, [MaybeNull] string e)
          {
              int x = a.Length + b.Length + c.Length;
              b = null;
              c = null;
              a = null;
              int y = e.Length;
              d = "x";
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'reachability',
    cs`
      #nullable enable
      using System;
      using System.Diagnostics.CodeAnalysis;
      static class P
      {
          [DoesNotReturn] static void Fail() => throw new Exception();
          [DoesNotReturn] static void FailWith(string message) => throw new Exception(message);
          static void Assert([DoesNotReturnIf(false)] bool condition) { if (!condition) throw new Exception(); }
          static void Refute([DoesNotReturnIf(true)] bool condition) { if (condition) throw new Exception(); }

          static void Reach(string? p, string? q, string? r, string? s)
          {
              if (p == null) Fail();
              int a = p.Length;
              Assert(q != null);
              int b = q.Length;
              Refute(r == null);
              int c = r.Length;
              if (s is null) FailWith("s");
              int d = s.Length;
          }
          static int Chained(string? s, object? o, int? v)
          {
              Assert(o is string);
              Assert(v.HasValue && s != null);
              string t = o.ToString() ?? "";
              return s.Length;
          }
          static void Unchecked(string? p, string? q)
          {
              Assert(p == null);
              int a = p.Length;
              Refute(q != null);
              int b = q.Length;
          }
          static void Main() { }
      }
    `,
  ),
]);
