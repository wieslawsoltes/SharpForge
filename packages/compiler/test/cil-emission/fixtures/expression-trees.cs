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

class Point
{
    public int X;
    public int Y { get; set; }
    public static int Count = 7;
    public Point() { }
    public Point(int x, int y) { X = x; Y = y; }
    public int Sum(int extra) { return X + Y + extra; }
    public static int Twice(int value) { return value * 2; }
    public static Point operator +(Point a, Point b) { return new Point(a.X + b.X, a.Y + b.Y); }
}

static class Extensions
{
    public static int Plus(this int value, int other) { return value + other; }
}

class Program
{
    int own = 4;

    static void Show(Expression tree)
    {
        Walker walker = new Walker();
        walker.Visit(tree);
        Console.WriteLine(tree);
        Console.WriteLine("  " + walker.Kinds.Trim());
    }

    Expression<Func<int, int>> UsesThis() { return x => x + own; }

    static void Main()
    {
        Expression<Func<int, int, int>> arithmetic = (a, b) => a * b - a / 2 % 3;
        Expression<Func<int, bool>> logic = x => x > 1 && x <= 10 || x == -5;
        Expression<Func<double, int>> narrow = d => (int)d;
        Expression<Func<int, object>> box = x => x;
        Expression<Func<object, string>> asString = o => o as string;
        Expression<Func<object, bool>> isString = o => o is string;
        Expression<Func<int, string>> choose = x => x > 0 ? "positive" : "other";
        Expression<Func<string, string>> coalesce = s => s ?? "none";
        Expression<Func<int, int>> checkedAdd = x => checked(x + 1);
        Expression<Func<string, string>> text = s => s + "!" + s.Length;
        Expression<Func<Point, int>> members = p => p.X + p.Y + Point.Count;
        Expression<Func<Point, int>> calls = p => p.Sum(3) + Point.Twice(p.X).Plus(2);
        Expression<Func<int, Point>> create = x => new Point(x, 2);
        Expression<Func<int, Point>> initialize = x => new Point { X = x, Y = 1 };
        Expression<Func<int, int[]>> array = x => new int[] { x, 2 };
        Expression<Func<int[], int>> element = a => a[1] + a.Length;
        Expression<Func<List<int>>> list = () => new List<int> { 1, 2 };
        Expression<Func<Point, Point, Point>> userOperator = (a, b) => a + b;
        Expression<Func<Func<int, int>, int, int>> invoke = (f, x) => f(x);
        Expression<Func<int, Func<int, int>>> nested = x => y => x + y;
        foreach (Expression tree in new Expression[] {
            arithmetic, logic, narrow, box, asString, isString, choose, coalesce, checkedAdd, text, members, calls,
            create, initialize, array, element, list, userOperator, invoke, nested, new Program().UsesThis() })
        {
            Show(tree);
        }

        int offset = 10;
        Expression<Func<int, int>> captured = x => x + offset;
        Func<int, int> compiled = captured.Compile();
        Console.WriteLine(compiled(1));
        offset = 100;
        Console.WriteLine(compiled(1));
        Console.WriteLine(arithmetic.Compile()(6, 7));
        Console.WriteLine(calls.Compile()(new Point(1, 2)));
        Console.WriteLine(nested.Compile()(3)(4));
        Console.WriteLine(text.Compile()("ab"));
        Console.WriteLine(new Program().UsesThis().Compile()(1));
        Console.WriteLine(initialize.Compile()(5).Sum(0));
        Console.WriteLine(captured.NodeType);
    }
}
