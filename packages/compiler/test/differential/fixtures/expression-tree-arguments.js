/**
 * Differential fixtures for the C# 14 change "expression trees with optional and named arguments"
 * (SF-A02-T12.3): below C# 14 an invocation in an expression tree may not omit optional arguments (CS0854) or name
 * arguments (CS0853); from C# 14 both are allowed and only out-of-position named arguments are reported (CS9307).
 */
import { cs, diag, feature } from './kit.js';

const source = cs`
  using System;
  using System.Linq.Expressions;
  class Box
  {
      public Box(int a, int b = 2) { }
      public int this[int i, int j = 0] { get { return i + j; } }
  }
  class Program
  {
      static int M(int a, int b = 2) { return a + b; }
      static int N(int a, int b) { return a + b; }
      static void Main()
      {
          Expression<Func<int>> optional = () => M(1);
          Expression<Func<int>> namedAndOptional = () => M(a: 1);
          Expression<Func<int>> named = () => N(a: 1, b: 2);
          Expression<Func<int>> all = () => M(1, 2);
          Expression<Func<Box>> creation = () => new Box(1);
          Expression<Func<Box, int>> indexer = box => box[1];
          Expression<Func<int>> outOfPosition = () => N(b: 2, a: 1);
          Func<int> lambda = () => M(a: 1);
      }
  }
`;

export const fixtures = feature('expression-tree-arguments', [
  diag('cs0854-cs0853-below-csharp-14', source, { langVersion: '13' }),
  diag('cs9307-only-from-csharp-14', source, { langVersion: '14' }),
]);
