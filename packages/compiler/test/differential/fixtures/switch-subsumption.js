/**
 * Differential fixtures for arms that can never be chosen because of the arms before them (SF-A02-T08.3):
 * CS8120 in a switch statement and CS8510 in a switch expression, behind a discard arm, behind a run-time type test
 * (`case object o: ... case string s:`), for constants behind a type test, and the programs that must stay clean.
 */
import { cs, diag, feature } from './kit.js';

const hierarchy = `
  class A { public int X; }
  class B : A { }
  class C : B { }
  interface I { }
  sealed class S { }
  enum E { One, Two }`;

export const fixtures = feature('switch-subsumption', [
  diag(
    'cs8120-case-behind-type-test',
    cs`
      using System;
      ${hierarchy}
      static class P
      {
          static int Objects(object o)
          {
              switch (o)
              {
                  case object q: return 1;
                  case string s: return 2;
              }
              return 0;
          }
          static int Classes(A a)
          {
              switch (a)
              {
                  case B b when b.X > 0: return 1;
                  case B b: return 2;
                  case C c: return 3;
                  case B _: return 4;
                  case { X: 3 }: return 5;
                  case A x: return 6;
              }
              return 0;
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8510-arm-behind-type-test',
    cs`
      using System;
      ${hierarchy}
      static class P
      {
          static int Derived(object o) => o switch { A a => 1, B b => 2, string s => 3, I i => 4, S s2 => 5, _ => 0 };
          static int Guarded(object o) => o switch { string s when s.Length > 0 => 1, string s => 2, string => 3, _ => 0 };
          static int NotNull(object o) => o switch { not null => 1, string s => 2, null => 3 };
          static int Static(A a) => a switch { A => 1, null => 2, B => 3 };
          static int Union(object o) => o switch { B or C => 1, C => 2, B => 3, A => 4, _ => 5 };
          static int Interface(I i) => i switch { A a => 1, B b => 2, _ => 3 };
          static int Recursive(object o) => o switch { B { } => 1, C c => 2, { } => 3, A => 4, null => 5 };
          static int Properties(object o) => o switch { A { X: 1 } => 1, B => 2, A => 3, B { X: 2 } => 4, _ => 6 };
          static int Arrays(object o) => o switch { Array => 1, int[] => 2, string[] => 3, _ => 4 };
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8510-constant-behind-type-test',
    cs`
      using System;
      ${hierarchy}
      static class P
      {
          static int Boxed(object o) => o switch { int i => 1, 5 => 2, long l => 3, _ => 4 };
          static int Mixed(object o) =>
              o switch { int i when i > 0 => 1, int i => 2, > 5 => 3, long => 4, 5L => 5, "a" => 6, string => 7, "b" => 8, _ => 9 };
          static int Lifted(int? n) => n switch { int i => 1, 3 => 2, null => 3 };
          static int Relational(int? n) => n switch { > 3 => 1, int => 2, 2 => 3, _ => 6 };
          static int Enums(ValueType v) => v switch { int => 1, Enum => 2, E => 3, E.One => 4, _ => 6 };
          static int Combined(object o) => o switch { int or long => 1, int and > 3 => 2, long or string => 3, int or long => 4, _ => 6 };
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8510-type-parameters',
    cs`
      ${hierarchy}
      static class P
      {
          static int Constrained<T>(T t) where T : A => t switch { B => 1, A => 2, T => 3, _ => 4 };
          static int Open<T>(T t) => t switch { int => 1, T => 2, string => 3, null => 4 };
          static int NullOfOpen<T>(T t) => t switch { null => 1, _ => 2 };
          static int NullOfStruct<T>(T t) where T : struct => t switch { null => 1, _ => 2 };
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8510-after-discard-arm',
    cs`
      using System;
      static class P
      {
          static string Discard(int n) => n switch { _ => "any", 1 => "one" };
          static string Var(string s) => s switch { var x => x, "a" => "b", null => "c" };
          static void Main() { Console.WriteLine(Discard(1) + Var("a")); }
      }
    `,
  ),
  diag(
    'cs8509-type-tests-are-not-exhaustive',
    cs`
      using System;
      ${hierarchy}
      abstract class Shape { }
      sealed class Circle : Shape { }
      sealed class Square : Shape { }
      static class P
      {
          static int OneType(object o) => o switch { string s => 1 };
          static int WithNull(object o) => o switch { string s => 1, null => 2 };
          static int Derived(A a) => a switch { B => 1 };
          static int EverySubclass(Shape s) => s switch { Circle => 1, Square => 2 };
          static int Lifted(int? n) => n switch { int i => 1, null => 2 };
          static int Mixed(object o) => o switch { int i => 1, string s when s.Length > 1 => 2, 5L => 3 };
          static int Open<T>(T t) => t switch { int => 1, string => 2 };
          static int Parts(object o) => o switch { A { X: 1 } => 1, B => 2 };
          static int Whole(A a) => a switch { B => 1, A => 2 };
          static int Rest(A a) => a switch { B => 1, { X: 1 } => 2 };
          static int Split(A a) => a switch { B => 1, { X: > 1 } => 2, { X: <= 1 } => 3 };
          static int Complement(object o) => o switch { A => 1, not A => 2 };
          static int Interface(IComparable c) => c switch { int => 1, string => 2 };
          static int Union(object o) => o switch { A or string => 1 };
          static int Scalar(int n) => n switch { int and > 0 => 1 };
          static void Main() { }
      }
    `,
  ),
  diag(
    'unrelated-type-tests-are-reachable',
    cs`
      using System;
      ${hierarchy}
      static class P
      {
          static int Reverse(object o) => o switch { C => 1, B => 2, A => 3, _ => 4 };
          static int Unrelated(object o) => o switch { string => 1, I => 2, S => 3, long => 4, 5 => 5, int => 6, _ => 7 };
          static int Guards(object o) => o switch { A a when a.X > 0 => 1, B => 2, A => 3, _ => 4 };
          static int Nulls(A a) => a switch { B => 1, null => 2, A => 3 };
          static void Main() { }
      }
    `,
  ),
]);
