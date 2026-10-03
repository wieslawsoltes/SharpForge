/**
 * Differential fixtures for members a program cannot name (SF-A02-E05): accessors and operators called by their
 * metadata name are CS0571, in programs inside the execution profile too; a local whose type is an error gets the
 * type error only (no CS0219).
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = feature('special-members', [
  diag(
    'cs0571-accessor-called-by-metadata-name',
    cs`
      class C
      {
          public int X { get; set; }
      }
      class Program
      {
          static void Main()
          {
              var c = new C();
              c.set_X(7);
              System.Console.WriteLine(c.get_X());
          }
      }
    `,
  ),
  diag(
    'cs0571-accessors-events-indexers-operators',
    cs`
      using System;
      class C
      {
          public int X { get; set; }
          public static int S { get; set; }
          public event Action E;
          public int this[int i] { get { return i; } }
          public static C operator +(C a, C b) { return a; }
          void M()
          {
              set_X(1);
              int a = this.get_X();
              int b = C.get_S();
              add_E(null);
              int c = get_Item(1);
              C d = op_Addition(this, this);
              Func<int> f = get_X;
              E();
          }
      }
      class Program
      {
          static void Main()
          {
              int y = new C().get_Y();
          }
      }
    `,
  ),
  diag(
    'cs0246-local-of-unknown-type-has-no-cs0219',
    cs`
      class Program
      {
          static void Main()
          {
              Foo f = null;
              var b = null;
              int ok = 1;
              Foo g;
          }
      }
    `,
  ),
]);
