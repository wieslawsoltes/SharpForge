/** Exact Roslyn diagnostics for declaration, target-type and tree-body restrictions (SF-A02-T07.5). */
import { cs, diag, feature } from './kit.js';

export const fixtures = feature('expression-tree-restrictions', [
  diag('invalid-delegate-type-and-anonymous-method-precedence', cs`
    using System;
    using System.Linq.Expressions;
    class Program
    {
        public Expression<int> Invalid = () => 1;
        public Expression<Delegate> BaseDelegate = () => 1;
        public Expression<int> AnonymousInvalid = delegate { return 1; };
        public Expression<Func<int>> Anonymous = delegate { return 1; };
        static Expression<T> Generic<T>() where T : Delegate => () => 1;
        static void Main() { }
    }
  `),
  diag('anonymous-types-in-attribute-and-constant-contexts', cs`
    using System;
    class MarkAttribute : Attribute { public MarkAttribute(object value) { } }
    [Mark(new { Value = 1 })]
    class Program
    {
        public const object Constant = new { Value = 2 };
        public object Field = new { Value = 3 };
        static void Main() { }
    }
  `),
  diag('function-operands-of-is-and-as', cs`
    using System;
    class Program
    {
        static int Method() => 1;
        static bool IsMethod() => Method is object;
        static object AsMethod() => Method as object;
        static bool IsLambda() => (() => 1) is object;
        static object AsLambda() => (() => 1) as object;
        static bool Pattern() => Method is { };
        static void Main() { }
    }
  `),
  diag('rectangular-initializers-including-empty', cs`
    using System;
    using System.Linq.Expressions;
    class Program
    {
        public Expression<Func<int[,]>> Nonempty = () => new int[,] { { 1, 2 } };
        public Expression<Func<int[,]>> Empty = () => new int[0, 0] { };
        public Expression<Func<int[,]>> Allocation = () => new int[2, 3];
        public Func<int[,]> Delegate = () => new int[,] { { 1, 2 } };
        static void Main() { }
    }
  `),
  diag('by-reference-lambda-and-returning-members', cs`
    using System;
    using System.Linq.Expressions;
    delegate int RefParameter(ref int value);
    delegate int InParameter(in int value);
    class Program
    {
        static int Value;
        static ref int Reference() => ref Value;
        static ref int Property => ref Value;
        public Expression<RefParameter> Ref = (ref int value) => value;
        public Expression<InParameter> In = (in int value) => value;
        public Expression<Func<int>> Call = () => Reference();
        public Expression<Func<int>> Read = () => Property;
        static void Main()
        {
            int Local() => 1;
            Expression<Func<Func<int>>> group = () => Local;
            Console.WriteLine(group);
        }
    }
  `),
]);
