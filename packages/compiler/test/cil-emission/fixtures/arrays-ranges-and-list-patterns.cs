using System;

struct Cell
{
    public int Value;
    public void Bump() { Value++; }
}

class Grid<T>
{
    T[,] cells;
    public Grid(int rows, int columns) { cells = new T[rows, columns]; }
    public T this[int row, int column]
    {
        get { return cells[row, column]; }
        set { cells[row, column] = value; }
    }
    public int Count { get { return cells.Length; } }
}

class Track
{
    int[] data = { 10, 20, 30, 40 };
    public int Length { get { Console.Write("[Length]"); return data.Length; } }
    public int this[int index]
    {
        get { Console.Write("[get]"); return data[index]; }
        set { Console.Write("[set]"); data[index] = value; }
    }
    public string Slice(int start, int length) { return start + ":" + length; }
}

class Program
{
    static int calls;

    static int Next() { Console.Write("[next]"); return ++calls; }

    static void Increment(ref int value) { value += 100; }

    static int Sum(int[,] matrix)
    {
        int sum = 0;
        for (int i = 0; i < matrix.GetLength(0); i++)
            for (int j = 0; j < matrix.GetLength(1); j++) sum += matrix[i, j];
        return sum;
    }

    static string Shape(int[] values)
    {
        switch (values)
        {
            case []: return "empty";
            case [var only]: return "one " + only;
            case [1, .., 9]: return "from 1 to 9";
            case [var first, .. var middle, var last]: return first + " (" + middle.Length + ") " + last;
            default: return "null";
        }
    }

    static void Main()
    {
        // Multi-dimensional arrays: creation, elements, compound assignment, addresses.
        int[,] grid = new int[2, 3];
        grid[1, 2] = 7;
        grid[0, 1] += 2;
        grid[0, 0]++;
        Increment(ref grid[1, 1]);
        Console.WriteLine(grid[1, 2] + " " + grid[0, 0] + " " + grid[0, 1] + " " + grid[1, 1]);
        Console.WriteLine(grid.Length + " " + grid.Rank + " " + grid.GetLength(0) + " " + grid.GetLength(1) + " " + Sum(grid));
        int[,] table = { { 1, 2 }, { 3, 4 }, { 5, 6 } };
        int digits = 0;
        foreach (int value in table)
        {
            if (value == 4) continue;
            digits = digits * 10 + value;
        }
        Console.WriteLine(digits);
        string[,] names = new string[2, 2] { { "a", "b" }, { "c", "d" } };
        Console.WriteLine(names[1, 0] + names[0, 1]);
        int[,,] cube = new int[2, 3, 4];
        cube[1, 2, 3] = 5;
        Console.WriteLine(cube[1, 2, 3] + cube.Length + cube.GetLength(2));
        int[][,] mix = new int[2][,];
        mix[0] = new int[1, 1];
        mix[0][0, 0] = 9;
        Console.WriteLine(mix[0][0, 0] + " " + (mix[1] == null));
        Cell[,] cells = new Cell[1, 2];
        cells[0, 1].Value = 4;
        cells[0, 1].Bump();
        Console.WriteLine(cells[0, 1].Value + " " + cells[0, 0].Value);
        var typed = new Grid<string>(2, 2);
        typed[1, 1] = "x";
        Console.WriteLine(typed[1, 1] + typed.Count + (typed[0, 0] == null));
        try { grid[2, 0] = 1; } catch (IndexOutOfRangeException) { Console.WriteLine("out of range"); }

        // Index and Range values.
        int[] a = { 1, 2, 3, 4, 5 };
        Index last = ^1;
        Index second = 1;
        Range inner = 1..^1;
        Range all = ..;
        Range tail = ^2..;
        Console.WriteLine(a[last] + " " + a[second] + " " + last.Value + " " + last.IsFromEnd + " " + inner.Start.Value + " " + inner.End.IsFromEnd);
        Console.WriteLine(a[inner].Length + " " + a[all].Length + " " + a[tail][0] + " " + a[second..last].Length + " " + a[..2][1] + " " + a[3..][0]);
        Console.WriteLine(last.GetOffset(5) + " " + new Index(2, true).Value + " " + new Range(1, 2).End.Value);
        int[] copy = a[1..3];
        copy[0] = 99;
        Console.WriteLine(a[1] + " " + copy[0] + " " + copy.Length + " " + a[^2] + " " + a[^Next()]);
        try { Console.WriteLine(a[4..2].Length); } catch (ArgumentOutOfRangeException) { Console.WriteLine("bad range"); }
        try { Console.WriteLine(a[..9].Length); } catch (ArgumentOutOfRangeException) { Console.WriteLine("bad range"); }
        string text = "hello world";
        Range word = 6..;
        Console.WriteLine(text[^1] + " " + text[..5] + " " + text[word] + " " + text[1..^1] + " " + text[last]);

        // Length, indexer and Slice members; the operand is evaluated before the length.
        var track = new Track();
        Console.WriteLine(track[^1] + " " + track[1..3] + " " + track[..^1]);
        track[^Next()] += 5;
        Console.WriteLine();
        Console.WriteLine(track[last]);

        // List patterns.
        Console.WriteLine(Shape(new int[0]) + "; " + Shape(new[] { 7 }) + "; " + Shape(new[] { 1, 5, 9 }) + "; " + Shape(new[] { 2, 3, 4, 5 }) + "; " + Shape(null));
        int[] numbers = { 1, 2, 3, 4 };
        if (numbers is [var head, .. [2, var third], 4] && numbers is [_, .. var body, _]) Console.WriteLine(head + " " + third + " " + body[0] + body[1]);
        Console.WriteLine(numbers is [1, 2, 3] ? "three" : numbers is [.., > 3] ? "ends above three" : "no");
        string[] words = { "x", "y" };
        Console.WriteLine(words is ["x", var y] ? y : "no");
    }
}
