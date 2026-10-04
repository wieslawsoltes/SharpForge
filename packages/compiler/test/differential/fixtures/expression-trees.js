/**
 * Differential fixtures for SF-A02-T07.5: lambdas converted to `Expression<TDelegate>`.
 *
 * The output fixtures print, for each tree, what `Expression.ToString()` gives on .NET and the node types an
 * `ExpressionVisitor` meets, in visiting order: the shape Roslyn built. The older shape test compares the lowering's
 * description with these pins (tests/compiler-expression-trees.test.js); direct CIL also runs on .NET, while the
 * source-image runtime has no System.Linq.Expressions. The diagnostics fixtures pin what may not appear in a tree.
 */
import { cs, out, diag, feature } from './kit.js';

const prelude = `
    using System;
    using System.Collections.Generic;
    using System.Linq.Expressions;
    class Walker : ExpressionVisitor
    {
        public string Kinds = "";
        public override Expression Visit(Expression node)
        {
            if (node != null) Kinds += node.NodeType + " ";
            return base.Visit(node);
        }
    }
    static class Tree
    {
        public static void Show(Expression e)
        {
            var walker = new Walker();
            walker.Visit(e);
            Console.WriteLine(e);
            Console.WriteLine(walker.Kinds.Trim());
        }
    }`;

const shapes = [
  out(
    'arithmetic-comparison-and-logic',
    cs`${prelude}
    class Program
    {
        static void Main()
        {
            Expression<Func<int, int>> add = x => x + 1;
            Expression<Func<int, int, int>> mixed = (a, b) => a * b - a / 2 % 3;
            Expression<Func<int, bool>> compare = x => x > 1 && x <= 10 || x == -5;
            Expression<Func<bool, bool, bool>> logic = (p, q) => !p & q | p ^ q;
            Expression<Func<int, int>> bits = x => ~x << 2 >> 1 & 7;
            Expression<Func<double, double>> real = d => -d * 2.5;
            Expression<Func<int>> constant = () => 42;
            Expression<Func<string, string>> text = s => s + "!" + s;
            Tree.Show(add);
            Tree.Show(mixed);
            Tree.Show(compare);
            Tree.Show(logic);
            Tree.Show(bits);
            Tree.Show(real);
            Tree.Show(constant);
            Tree.Show(text);
        }
    }
  `,
  ),
  out(
    'conversions-conditionals-and-checked',
    cs`${prelude}
    class Program
    {
        static void Main()
        {
            Expression<Func<int, double>> widen = x => x;
            Expression<Func<double, int>> narrow = d => (int)d;
            Expression<Func<int, object>> box = x => x;
            Expression<Func<object, string>> cast = o => (string)o;
            Expression<Func<object, string>> asString = o => o as string;
            Expression<Func<object, bool>> isString = o => o is string;
            Expression<Func<int, string>> choose = x => x > 0 ? "positive" : "other";
            Expression<Func<string, string>> coalesce = s => s ?? "none";
            Expression<Func<int, int>> checkedAdd = x => checked(x + 1);
            Expression<Func<int, long>> widenSum = x => x + 1L;
            Tree.Show(widen);
            Tree.Show(narrow);
            Tree.Show(box);
            Tree.Show(cast);
            Tree.Show(asString);
            Tree.Show(isString);
            Tree.Show(choose);
            Tree.Show(coalesce);
            Tree.Show(checkedAdd);
            Tree.Show(widenSum);
        }
    }
  `,
  ),
  out(
    'members-calls-and-creation',
    cs`${prelude}
    class Point
    {
        public int X;
        public int Y { get; set; }
        public static int Count;
        public Point() { }
        public Point(int x, int y) { X = x; Y = y; }
        public int Sum(int extra) { return X + Y + extra; }
        public static int Twice(int v) { return v * 2; }
    }
    static class Extensions { public static int Plus(this int value, int other) { return value + other; } }
    class Program
    {
        static void Main()
        {
            Expression<Func<Point, int>> field = p => p.X;
            Expression<Func<Point, int>> property = p => p.Y;
            Expression<Func<int>> shared = () => Point.Count;
            Expression<Func<string, int>> length = s => s.Length;
            Expression<Func<Point, int>> instance = p => p.Sum(3);
            Expression<Func<int, int>> stat = x => Point.Twice(x);
            Expression<Func<int, int>> extension = x => x.Plus(2);
            Expression<Func<string, string>> framework = s => s.Substring(1);
            Expression<Func<int, Point>> create = x => new Point(x, 2);
            Expression<Func<int, Point>> initialize = x => new Point { X = x, Y = 1 };
            Expression<Func<int, int[]>> array = x => new int[] { x, 2 };
            Expression<Func<int, int[]>> bounds = x => new int[x];
            Expression<Func<int[], int>> element = a => a[1] + a.Length;
            Expression<Func<List<int>>> list = () => new List<int> { 1, 2 };
            Tree.Show(field);
            Tree.Show(property);
            Tree.Show(shared);
            Tree.Show(length);
            Tree.Show(instance);
            Tree.Show(stat);
            Tree.Show(extension);
            Tree.Show(framework);
            Tree.Show(create);
            Tree.Show(initialize);
            Tree.Show(array);
            Tree.Show(bounds);
            Tree.Show(element);
            Tree.Show(list);
        }
    }
  `,
  ),
  out(
    'delegates-nested-lambdas-and-operators',
    cs`${prelude}
    class Money
    {
        public int Amount;
        public static Money operator +(Money a, Money b) { return a; }
        public static bool operator ==(Money a, Money b) { return true; }
        public static bool operator !=(Money a, Money b) { return false; }
        public static implicit operator int(Money m) { return m.Amount; }
        public override bool Equals(object o) { return false; }
        public override int GetHashCode() { return 0; }
    }
    class Program
    {
        static int shared = 3;
        int own = 4;
        static void Log(string text) { }
        static void Main()
        {
            Expression<Func<Func<int, int>, int, int>> invoke = (f, x) => f(x);
            Expression<Func<int, Func<int, int>>> nested = x => y => x + y;
            Expression<Func<int, int>> staticField = x => x + shared;
            Expression<Func<Money, Money, Money>> userOperator = (a, b) => a + b;
            Expression<Func<Money, Money, bool>> userEquality = (a, b) => a == b;
            Expression<Func<Money, int>> userConversion = m => m;
            Expression<Action<string>> action = s => Log(s);
            Tree.Show(invoke);
            Tree.Show(nested);
            Tree.Show(staticField);
            Tree.Show(userOperator);
            Tree.Show(userEquality);
            Tree.Show(userConversion);
            Tree.Show(action);
            new Program().Instance();
        }
        void Instance()
        {
            Expression<Func<int, int>> usesThis = x => x + own;
            Tree.Show(usesThis);
        }
    }
  `,
  ),
];

const restrictions = [
  diag(
    'statement-bodies-and-assignments',
    cs`
    using System;
    using System.Linq.Expressions;
    class Program
    {
        static int field;
        static void Main()
        {
            Expression<Func<int, int>> block = x => { return x; };
            Expression<Func<int, int>> assign = x => field = x;
            Expression<Func<int, int>> compound = x => field += x;
            Expression<Func<int, int>> increment = x => field++;
            Expression<Action> empty = () => { };
        }
    }
  `,
  ),
  diag(
    'newer-expression-forms',
    cs`
    using System;
    using System.Collections.Generic;
    using System.Linq.Expressions;
    class Program
    {
        static int Optional(int a, int b = 2) { return a + b; }
        static void Out(out int x) { x = 1; }
        static void Main()
        {
            Expression<Func<string, int?>> nullConditional = s => s?.Length;
            Expression<Func<int, int>> optional = x => Optional(x);
            Expression<Func<int, int>> named = x => Optional(b: 1, a: x);
            Expression<Func<object, bool>> pattern = o => o is int i;
            Expression<Func<int, string>> switchExpression = x => x switch { 1 => "one", _ => "other" };
            Expression<Func<string, string>> throwExpression = s => s ?? throw new Exception();
            Expression<Func<Dictionary<string, int>>> indexInitializer = () => new Dictionary<string, int> { ["a"] = 1 };
            Expression<Func<(int, int)>> tuple = () => (1, 2);
            Expression<Func<int, int>> local = x => Twice(x);
            int Twice(int v) { return v * 2; }
        }
    }
  `,
  ),
  diag(
    'async-and-base-access',
    cs`
    using System;
    using System.Linq.Expressions;
    using System.Threading.Tasks;
    class Base { public virtual int Value() { return 1; } }
    class Derived : Base
    {
        public override int Value() { return 2; }
        void M()
        {
            Expression<Func<int>> viaBase = () => base.Value();
            Expression<Func<Task<int>>> asyncLambda = async () => await Task.FromResult(1);
        }
    }
    class Program { static void Main() { } }
  `,
  ),
];

export const fixtures = feature('expression-trees', [...shapes, ...restrictions]);
