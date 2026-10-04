/**
 * Differential fixtures for three diagnostics of C# 7 to 12 features:
 *   CS8383  a tuple element name ignored by `==` / `!=` (SF-A02-T60, C# 7.3 tuple equality)
 *   CS8199  `out var (a, b)`: the syntax is reserved as an lvalue (SF-A02-T58, out variables)
 *   CS9130, CS9131, CS9132, CS0214, CS0227  `using unsafe` and aliases of any type (SF-A02-T80, C# 12)
 */
import { cs, diag, feature } from './kit.js';

const aliases = cs`
  #nullable enable
  using NS = string?;
  using NI = int?;
  using RI = ref int;
  using NA = string?[];
  using LS = System.Collections.Generic.List<string?>;
  using unsafe System;
  using static unsafe System.Console;
  using unsafe UP = int*;
  using Safe = int*;
  using Ptrs = int*[];
  using unsafe Arr = int[];
  static class P
  {
      static unsafe void M(UP p, Safe q) { }
      static void N(UP p) { }
      static void Main() { }
  }
`;

export const fixtures = [
  ...feature('tuple-equality-names', [
    diag(
      'cs8383-names-ignored-by-equality',
      cs`
        static class P
        {
            static (int a, int b) Pair() => (1, 2);
            static void M()
            {
                (int a, int b) named = (1, 2);
                (int x, int y) other = (1, 2);
                (int, int) plain = (1, 2);
                bool r1 = named == (c: 1, d: 2);
                bool r2 = named == (a: 1, b: 2);
                bool r3 = named == (b: 1, a: 2);
                bool r4 = named != other;
                bool r5 = (x: 1, y: 2) == (a: 1, b: 2);
                bool r6 = plain == (c: 1, d: 2);
                bool r7 = (c: 1, d: 2) == plain;
                bool r8 = named == (1, 2);
                bool r9 = Pair() == (q: 1, 2);
                bool r10 = (named, 1) == ((e: 1, f: 2), g: 1);
                bool r11 = named == (a: 1, z: 2);
                int n = 1, m = 2;
                bool r12 = named == (n, m);
                bool r13 = (n, m) == (a: 1, b: 2);
                bool r14 = (n: 1, m: 2) == (n, m);
                (long a, int b) wide = (1L, 2);
                bool r15 = wide == (c: 1, d: 2);
                bool r16 = named != (c: 1L, d: 2L);
            }
            static void Main() { }
        }
      `,
    ),
  ]),
  ...feature('out-variables', [
    diag(
      'cs8199-var-pattern-as-out-argument',
      cs`
        static class P
        {
            static void Get(out (int, int) pair) { pair = (1, 2); }
            static void One(out int value) { value = 1; }
            static void M()
            {
                Get(out var (a, b));
                One(out var (e, f));
                Get(out var ok);
                Get(out var (g, (h, i)));
                var (j, k) = (1, 2);
                Get(out var _);
            }
            static void Main() { }
        }
      `,
    ),
  ]),
  ...feature('using-unsafe-aliases', [
    diag('alias-rules-with-unsafe', aliases, { allowUnsafe: true }),
    diag('alias-rules-without-unsafe', aliases),
  ]),
];
