/**
 * Differential fixtures for the nullable annotations of framework members (SF-A02-T05.4): Object.ToString and
 * Environment.GetEnvironmentVariable return `string?`, while the ToString overrides of framework types and of the
 * program's own classes have the annotation they declare.
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = feature('nullable-framework-annotations', [
  diag(
    'tostring-and-environment',
    cs`
      #nullable enable
      using System;
      class C { }
      class D { public override string ToString() => "d"; }
      class E { public override string? ToString() => null; }
      static class P
      {
          static void Objects(object o, C c, D d, E e, string s, int i, Exception x)
          {
              string a = o.ToString();
              string b = c.ToString();
              string f = d.ToString();
              string g = s.ToString();
              string h = i.ToString();
              string j = x.Message;
              string m = x.ToString();
              int n = o.ToString().Length;
              string k = e.ToString();
              string? ok = o.ToString();
              string t = o.ToString() ?? "";
              string u = o.ToString()!;
              object p = d;
              string v = p.ToString();
          }
          static void Statics()
          {
              string a = Environment.GetEnvironmentVariable("X");
              string? b = Environment.GetEnvironmentVariable("X");
              int n = b.Length;
              string f = string.Concat("a", "b");
          }
          static void Main() { }
      }
    `,
  ),
]);
