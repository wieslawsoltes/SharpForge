/**
 * Differential fixtures for lambdas in the nullable analysis (SF-A02-T05.4): the body of a lambda or anonymous method
 * is checked against the delegate type it is converted to - a possibly null return for a non-nullable result (CS8603),
 * a nullable parameter dereferenced (CS8602) - with the annotations of the delegate's type arguments
 * (`Func<string>` against `Func<string?>`). The output fixture runs delegates of annotated types on both back ends.
 */
import { cs, diag, out, feature } from './kit.js';

export const fixtures = feature('nullable-lambdas', [
  diag(
    'cs8603-cs8602-against-the-delegate-type',
    cs`
      #nullable enable
      using System;
      delegate string Make();
      delegate string? MakeMaybe();
      delegate T Gen<T>();
      static class P
      {
          static string? Maybe() => null;
          static void M(string? n, string s)
          {
              Func<string> a = () => null;
              Func<string?> b = () => null;
              Func<string> c = () => n;
              Func<string> d = () => { if (n == null) return s; return n; };
              Func<string> e = () => { return Maybe(); };
              Make f = () => n;
              MakeMaybe g = () => n;
              Gen<string> h = () => n;
              Gen<string?> i = () => n;
              Func<string, string> j = x => x;
              Func<string?, string> k = x => x;
              Func<string?, int> l = x => x.Length;
              Func<string, int> m = x => x.Length;
              Func<string> o = delegate { return n; };
              Func<string?, string?, int> p = (x, y) => x == null ? 0 : x.Length + y.Length;
              Action<string?> q = x => Console.WriteLine(x.Length);
              Func<string> ok = () => n ?? s;
              Func<string> forgiven = () => n!;
          }
          static void Main() { }
      }
    `,
  ),
  out(
    'delegates-of-annotated-types-run',
    cs`
      #nullable enable
      using System;
      static class P
      {
          static int Apply(Func<string?, int> measure, string? text) => measure(text);
          static void Main()
          {
              Func<string> sure = () => "x";
              Func<string?> maybe = () => null;
              Func<string?, int> length = s => s == null ? 0 : s.Length;
              Action<string?> print = s => Console.WriteLine(s ?? "none");
              Console.WriteLine(sure() + (maybe() ?? "null") + length("abc"));
              print(null);
              print("some");
              Console.WriteLine(Apply(length, null) + Apply(s => s == null ? -1 : 1, "a"));
          }
      }
    `,
  ),
]);
