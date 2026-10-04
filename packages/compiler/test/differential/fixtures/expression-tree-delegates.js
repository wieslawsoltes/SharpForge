/** Delegate creation, reflection constants and by-reference calls on real .NET (SF-A02-T07.5). */
import { cs, out, feature } from './kit.js';

const prelude = `
using System;
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
    public static void Show(Expression expression)
    {
        var walker = new Walker();
        walker.Visit(expression);
        Console.WriteLine(expression);
        Console.WriteLine(walker.Kinds.Trim());
    }
}`;

export const fixtures = feature('expression-tree-delegates', [
  out('static-instance-generic-extension-and-delegate-copy', cs`${prelude}
    class Counter
    {
        public int Value;
        public Counter(int value) { Value = value; }
        public virtual int Read() => Value;
    }
    class Derived : Counter
    {
        public Derived(int value) : base(value) { }
        public override int Read() => Value + 10;
    }
    struct ValueCounter
    {
        public int Value;
        public int Read() => Value;
    }
    static class Extensions { public static int LengthPlus(this string value, int extra) => value.Length + extra; }
    class Program
    {
        static int Answer() => 42;
        static T Identity<T>(T value) => value;
        static void Main()
        {
            Expression<Func<Func<int>>> stat = () => Answer;
            Expression<Func<Counter, Func<int>>> instance = counter => counter.Read;
            Expression<Func<ValueCounter, Func<int>>> boxed = counter => counter.Read;
            Expression<Func<Func<int, int>>> generic = () => Identity<int>;
            Expression<Func<string, Func<int, int>>> extension = value => value.LengthPlus;
            Expression<Func<Func<int>, Func<int>>> copy = source => new Func<int>(source);
            Expression<Func<int, Func<int>>> nested = value => new Func<int>(() => value);
            Tree.Show(stat); Tree.Show(instance); Tree.Show(boxed); Tree.Show(generic);
            Tree.Show(extension); Tree.Show(copy); Tree.Show(nested);
            Console.WriteLine(stat.Compile()()());
            Console.WriteLine(instance.Compile()(new Derived(2))());
            Console.WriteLine(boxed.Compile()(new ValueCounter { Value = 8 })());
            Console.WriteLine(generic.Compile()()(7));
            Console.WriteLine(extension.Compile()("abc")(4));
            Func<int> original = Answer;
            Console.WriteLine(copy.Compile()(original)());
            Console.WriteLine(nested.Compile()(19)());
        }
    }
  `),
  out('delegate-operators-event-default-typeof-and-ref-calls', cs`${prelude}
    class Cell { public int Value; }
    struct Item { public int Value; }
    class Program
    {
        public static event Action Changed;
        static int Calls;
        static void First() { Calls += 1; }
        static void Second() { Calls += 10; }
        static int Bump(ref int value) { value += 1; return value; }
        static int Read(in int value) => value;
        static Expression<Func<T>> Default<T>() => () => default(T);
        static Expression<Func<T>> New<T>() where T : new() => () => new T();
        static void Main()
        {
            Expression<Func<Action, Action, Action>> combine = (a, b) => a + b;
            Expression<Func<Action, Action, Action>> remove = (a, b) => a - b;
            Expression<Func<Action, Action, bool>> equal = (a, b) => a == b;
            Expression<Func<Action>> handler = () => Changed;
            Expression<Func<Type>> type = () => typeof(Func<>);
            Expression<Func<Cell, int>> mutate = cell => Bump(ref cell.Value);
            Expression<Func<Cell, bool>> parse = cell => int.TryParse("17", out cell.Value);
            Expression<Func<Cell, int>> read = cell => Read(in cell.Value);
            Tree.Show(combine); Tree.Show(remove); Tree.Show(equal); Tree.Show(handler); Tree.Show(type);
            Tree.Show(mutate); Tree.Show(parse); Tree.Show(read); Tree.Show(Default<Item>()); Tree.Show(New<Cell>());
            Action first = First;
            Action second = Second;
            Action both = combine.Compile()(first, second);
            both();
            remove.Compile()(both, second)();
            Console.WriteLine(Calls);
            Console.WriteLine(equal.Compile()(First, first));
            Changed += first;
            handler.Compile()()();
            Console.WriteLine(Calls);
            Console.WriteLine(type.Compile()() == typeof(Func<>));
            Cell cell = new Cell { Value = 4 };
            Console.WriteLine(mutate.Compile()(cell) + ":" + cell.Value);
            Console.WriteLine(parse.Compile()(cell) + ":" + read.Compile()(cell));
            Console.WriteLine(Default<int>().Compile()());
            Console.WriteLine(Default<string>().Compile()() == null);
            Console.WriteLine(Default<Item>().Compile()().Value);
            Console.WriteLine(New<Cell>().Compile()().Value);
        }
    }
  `),
]);
