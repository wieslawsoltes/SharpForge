/** Real Roslyn tree shapes and compiled results for creation/initializer lowering (SF-A02-T07.5). */
import { cs, out, feature } from './kit.js';

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
    public static void Show(Expression expression)
    {
        var walker = new Walker();
        walker.Visit(expression);
        Console.WriteLine(expression);
        Console.WriteLine(walker.Kinds.Trim());
    }
}`;

export const fixtures = feature('expression-tree-creation', [
  out('nested-members-lists-and-empty-initializers', cs`${prelude}
    class Item { public int Value; }
    class Holder
    {
        public Item Field = new Item();
        public Item Property { get; } = new Item();
        public List<int> Values { get; } = new List<int>();
        public int Marker;
    }
    class Program
    {
        static void Main()
        {
            Expression<Func<int, Holder>> tree = value => new Holder
            {
                Field = { Value = value }, Property = { Value = value + 1 },
                Values = { value, value + 2 }, Marker = value + 3
            };
            Expression<Func<Holder>> empty = () => new Holder { };
            Expression<Func<Holder>> nestedEmpty = () => new Holder { Property = { } };
            Tree.Show(tree);
            Tree.Show(empty);
            Tree.Show(nestedEmpty);
            Holder result = tree.Compile()(5);
            Console.WriteLine(result.Field.Value + ":" + result.Property.Value + ":" + result.Values[1] + ":" + result.Marker);
        }
    }
  `),
  out('anonymous-members-and-generic-storage', cs`${prelude}
    class Program
    {
        static Expression<Func<T, object>> Make<T>() => value => new { Value = value };
        static void Main()
        {
            Expression<Func<int, object>> create = value => new { Number = value, Twice = value * 2 };
            Expression<Func<int, int>> read = value => new { Number = value + 1 }.Number;
            Expression<Func<object>> empty = () => new { };
            Tree.Show(create);
            Tree.Show(read);
            Tree.Show(empty);
            Tree.Show(Make<string>());
            Console.WriteLine(create.Compile()(7));
            Console.WriteLine(read.Compile()(7));
            Console.WriteLine(Make<string>().Compile()("value"));
        }
    }
  `),
  out('rectangular-bounds-access-and-wide-index', cs`${prelude}
    class Program
    {
        static void Main()
        {
            Expression<Func<int, int[,]>> allocate = size => new int[size, 2];
            Expression<Func<int[,], int, int>> access = (values, index) => values[0, index];
            Expression<Func<int[], long, int>> wide = (values, index) => values[index];
            Expression<Func<int[][]>> jagged = () => new int[][] { new int[] { 1, 2 } };
            Tree.Show(allocate);
            Tree.Show(access);
            Tree.Show(wide);
            Tree.Show(jagged);
            int[,] result = allocate.Compile()(3);
            result[0, 1] = 17;
            Console.WriteLine(result.GetLength(0) + ":" + access.Compile()(result, 1) + ":" + wide.Compile()(new int[] { 2, 9 }, 1));
            try { wide.Compile()(new int[1], long.MaxValue); }
            catch (OverflowException) { Console.WriteLine("overflow"); }
            Console.WriteLine(jagged.Compile()()[0][1]);
        }
    }
  `),
]);
