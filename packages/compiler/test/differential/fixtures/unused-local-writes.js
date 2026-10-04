/**
 * Differential fixtures for "a write is a use" (SF-A02-T34): which writes to a local that is never read are reported
 * as CS0219 - constants, `default`, a struct created without a declared constructor, also behind implicit
 * conversions - and which count as a use of the local (an object kept alive, the result of a call).
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = feature('unused-local-writes', [
  diag(
    'cs0219-constants-behind-conversions',
    cs`
      using System;
      struct Plain { public int X; }
      struct WithConstructor { public int X; public WithConstructor(int x) { X = x; } }
      class Box { }
      static class P
      {
          static int Compute() => 1;
          static void Values()
          {
              int? none = null;
              int? five = 5;
              long wide = 1;
              double ratio = 2;
              int zero = default;
              int typed = default(int);
              Plain plain = new Plain();
              Plain initialized = new Plain { X = 1 };
              WithConstructor made = new WithConstructor(1);
              WithConstructor empty = new WithConstructor();
              int computed = Compute();
              int sum = 1 + 2;
              const int limit = 3;
          }
          static void References()
          {
              string text = "a";
              string missing = null;
              object boxed = 1;
              object nothing = null;
              Box box = new Box();
              Box noBox = null;
              int[] numbers = new int[2];
              int[] none = null;
              Func<int> function = Compute;
              Func<int> noFunction = null;
          }
          static void Assignments()
          {
              int a; a = 1;
              int? b; b = null;
              int c; c = Compute();
              object d; d = null;
              object e; e = "x";
          }
          static void Main() { }
      }
    `,
  ),
]);
