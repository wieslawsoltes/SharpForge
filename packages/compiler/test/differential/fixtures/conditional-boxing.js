/**
 * Differential fixtures for a choice between a boxed primitive and `null` (or another reference): `flag ? (object)1 : null`,
 * `x ?? 1`, `(object)s?.Length`. On the image's evaluation stack a value has one representation, so the two branches
 * of such a choice must not meet there: the generator stores each branch through an `object` slot (`choose` in
 * codegen/semantic/translate-expressions.js). The CIL back end types a join of `null` and `int` as `int` and would
 * box the null; these programs pin that both back ends agree with .NET whichever branch is taken.
 */
import { cs, out, feature } from './kit.js';

export const fixtures = [
  ...feature('conditional-boxing', [
    out(
      'boxed-primitive-or-null-either-branch',
      cs`
        using System;
        interface IMarker { }
        class Program
        {
            static object A(bool t) { return t ? (object)1 : null; }
            static object B(bool t) { return t ? null : (object)1; }
            static object Pick(int k) { return k switch { 0 => (object)1, 1 => "one", _ => null }; }
            static string Show(object o) { return o == null ? "null" : o.ToString(); }
            static void Main()
            {
                foreach (bool t in new[] { true, false })
                {
                    object a = t ? (object)1 : null;
                    object b = t ? null : (object)1;
                    Console.WriteLine(Show(a) + " " + Show(b) + " " + Show(A(t)) + " " + Show(B(t)));
                    Console.WriteLine(Show(t ? (object)1 : null) + " " + Show(t ? null : (object)2.5));
                    int n = 7;
                    object c = t ? null : (object)(n + 1);
                    object d = t ? (object)true : "text";
                    object e = t ? (t ? (object)1 : null) : (object)2;
                    Console.WriteLine(Show(c) + " " + Show(d) + " " + Show(e));
                    object x = t ? "s" : null;
                    object f = x ?? 1;
                    Console.WriteLine(Show(f) + " " + Show(x ?? false));
                    string s = t ? "abc" : null;
                    object length = (object)s?.Length;
                    Console.WriteLine(Show(length));
                }
                Console.WriteLine(Show(Pick(0)) + Show(Pick(1)) + Show(Pick(2)));
            }
        }
      `,
    ),
    out(
      'boxed-primitive-or-null-in-the-execution-profile',
      cs`
        using System;
        class Program
        {
            static object A(bool t) { return t ? (object)1 : null; }
            static void Main()
            {
                bool t = false;
                object i = t ? (object)1 : null;
                Console.WriteLine(i == null);
                object j = t ? null : (object)1;
                Console.WriteLine(j);
                Console.WriteLine(A(false) == null);
                Console.WriteLine(A(true));
            }
        }
      `,
    ),
  ]),
];
