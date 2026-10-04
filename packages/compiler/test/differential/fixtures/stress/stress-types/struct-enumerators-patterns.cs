using System;
using System.Collections.Generic;
using System.Threading.Tasks;

public readonly struct Countdown
{
    private readonly int from;
    public Countdown(int from) { this.from = from; }
    public Enumerator GetEnumerator() => new Enumerator(from);

    public struct Enumerator
    {
        private int next;
        public Enumerator(int from) { next = from + 1; }
        public int Current => next;
        public bool MoveNext() => --next > 0;
    }
}

public ref struct SpanSplitter
{
    private ReadOnlySpan<char> rest;
    private readonly char separator;
    public SpanSplitter(ReadOnlySpan<char> text, char separator) { rest = text; this.separator = separator; Current = default; }
    public ReadOnlySpan<char> Current { get; private set; }
    public SpanSplitter GetEnumerator() => this;
    public bool MoveNext()
    {
        if (rest.IsEmpty) return false;
        int index = rest.IndexOf(separator);
        if (index < 0) { Current = rest; rest = default; }
        else { Current = rest.Slice(0, index); rest = rest.Slice(index + 1); }
        return true;
    }
}

public sealed class Disposables
{
    public static readonly List<string> Log = new List<string>();
}

public ref struct Scope
{
    private readonly string name;
    public Scope(string name) { this.name = name; Disposables.Log.Add("enter " + name); }
    public void Dispose() => Disposables.Log.Add("leave " + name);
}

public struct MutableDisposable : IDisposable
{
    public int Disposed;
    public void Dispose() { Disposed++; Disposables.Log.Add("struct disposed " + Disposed); }
}

public sealed class Tree
{
    public int Value;
    public Tree Left, Right;
    public Tree(int value, Tree left = null, Tree right = null) { Value = value; Left = left; Right = right; }
}

public static class Extensions
{
    public static IEnumerator<int> GetEnumerator(this Tree tree)
    {
        if (tree.Left != null) foreach (int value in tree.Left) yield return value;
        yield return tree.Value;
        if (tree.Right != null) foreach (int value in tree.Right) yield return value;
    }

    public static IEnumerator<int> GetEnumerator(this Range range)
    {
        for (int i = range.Start.Value; i < range.End.Value; i++) yield return i;
    }

    public static IEnumerator<T> GetEnumerator<T>(this (T, T, T) triple)
    {
        yield return triple.Item1;
        yield return triple.Item2;
        yield return triple.Item3;
    }

    public static System.Runtime.CompilerServices.TaskAwaiter<int> GetAwaiter(this int milliseconds) => Task.Delay(milliseconds).ContinueWith(_ => milliseconds * 2).GetAwaiter();
    public static void Deconstruct(this Tree tree, out int value, out bool leaf) { value = tree.Value; leaf = tree.Left == null && tree.Right == null; }
    public static void Add(this Stack<int> stack, int value) => stack.Push(value);
}

public sealed class Matrix
{
    private readonly int[,] cells;
    public Matrix(int[,] cells) { this.cells = cells; }
    public ref int this[int row, int column] => ref cells[row, column];
    public RowEnumerable Rows => new RowEnumerable(this);

    public readonly struct RowEnumerable
    {
        private readonly Matrix owner;
        public RowEnumerable(Matrix owner) { this.owner = owner; }
        public RowEnumerator GetEnumerator() => new RowEnumerator(owner);
    }

    public struct RowEnumerator
    {
        private readonly Matrix owner;
        private int row;
        public RowEnumerator(Matrix owner) { this.owner = owner; row = -1; }
        public bool MoveNext() => ++row < owner.cells.GetLength(0);
        public int[] Current
        {
            get
            {
                var result = new int[owner.cells.GetLength(1)];
                for (int column = 0; column < result.Length; column++) result[column] = owner.cells[row, column];
                return result;
            }
        }
        public void Dispose() => Disposables.Log.Add("rows done at " + row);
    }
}

public static class Program
{
    public static async Task Main()
    {
        int sum = 0;
        foreach (int tick in new Countdown(5)) sum = sum * 10 + tick;
        Console.Write(sum + " ");
        foreach (var part in new SpanSplitter("a,bb,,ccc", ',')) Console.Write(part.Length + ":" + part.ToString() + " ");
        foreach (int value in new Tree(4, new Tree(2, new Tree(1), new Tree(3)), new Tree(6, null, new Tree(7)))) Console.Write(value);
        Console.Write(" ");
        foreach (int i in 3..7) Console.Write(i);
        foreach (var item in ("x", "y", "z")) Console.Write(item);
        Console.WriteLine();

        var matrix = new Matrix(new[,] { { 1, 2 }, { 3, 4 }, { 5, 6 } });
        matrix[1, 1] = 40;
        matrix[2, 0]++;
        ref int corner = ref matrix[0, 0];
        corner -= 10;
        foreach (var row in matrix.Rows) Console.Write("[" + string.Join(",", row) + "]");
        Console.WriteLine(" " + string.Join("; ", Disposables.Log));
        Disposables.Log.Clear();

        using (new Scope("outer"))
        {
            using var inner = new Scope("inner");
            var mutable = new MutableDisposable();
            using (mutable) { Disposables.Log.Add("body sees " + mutable.Disposed); }
            Disposables.Log.Add("after using " + mutable.Disposed);
        }
        Console.WriteLine(string.Join("; ", Disposables.Log));

        int doubled = await 3;
        var (value2, leaf) = new Tree(9);
        var stack = new Stack<int> { 1, 2, 3 };
        Console.WriteLine(doubled + " " + value2 + leaf + " " + stack.Pop() + stack.Count + " " + (new Tree(5, new Tree(1)) is (5, false)));
        var enumerator = new Countdown(3).GetEnumerator();
        var copy = enumerator;
        enumerator.MoveNext();
        enumerator.MoveNext();
        copy.MoveNext();
        Console.WriteLine(enumerator.Current + " " + copy.Current);
        IEnumerable<int> Boxed()
        {
            foreach (int tick in new Countdown(2)) yield return tick;
        }
        Console.WriteLine(string.Join(",", Boxed()));
    }
}
