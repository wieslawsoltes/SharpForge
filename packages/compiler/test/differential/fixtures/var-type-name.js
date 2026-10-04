/**
 * Differential fixtures for a type named `var` (SF-A02-T52): `var` is a contextual keyword only while no type of that
 * name is in scope. With one, `var x = e;` declares a variable of that type - also in programs the execution profile
 * compiles by itself, which is where the rule was missing.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('var-type-name', [
    out(
      'a-class-named-var-is-the-type-of-the-declaration',
      cs`
        using System;
        class var
        {
            public int X = 3;
        }
        class Program
        {
            static void Main()
            {
                var v = new var();
                var none = null;
                Console.WriteLine(v.X);
                Console.WriteLine(none == null);
            }
        }
      `,
    ),
    diag(
      'cs0029-var-is-not-inferred-when-a-type-has-the-name',
      cs`
        using System;
        class var
        {
            public int X = 3;
        }
        class Program
        {
            static void Main()
            {
                var v = new var();
                Console.WriteLine(v.X);
                var w = 5;
                var s = "text";
            }
        }
      `,
    ),
  ]),
];
