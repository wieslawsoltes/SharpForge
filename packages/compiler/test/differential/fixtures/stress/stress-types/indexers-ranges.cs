using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public sealed class Grid<T>
{
    private readonly T[] cells;
    public Grid(int rows, int columns) { Rows = rows; Columns = columns; cells = new T[rows * columns]; }
    public int Rows { get; }
    public int Columns { get; }

    public T this[int row, int column]
    {
        get => cells[Check(row, column)];
        set => cells[Check(row, column)] = value;
    }

    public T this[(int Row, int Column) position]
    {
        get => this[position.Row, position.Column];
        set => this[position.Row, position.Column] = value;
    }

    public IEnumerable<T> this[int row] => Enumerable.Range(0, Columns).Select(column => this[row, column]);

    public T this[Index row, Index column]
    {
        get => this[row.GetOffset(Rows), column.GetOffset(Columns)];
    }

    private int Check(int row, int column)
    {
        if ((uint)row >= (uint)Rows || (uint)column >= (uint)Columns) throw new ArgumentOutOfRangeException(row + "," + column);
        return row * Columns + column;
    }
}

public sealed class Sentence
{
    private readonly string[] words;
    public Sentence(string text) { words = text.Split(' '); }
    public int Length => words.Length;
    public string this[int index] => words[index];
    public Sentence Slice(int start, int length) => new Sentence(string.Join(" ", words, start, length));
    public override string ToString() => string.Join(" ", words);
}

public sealed class Registry
{
    private readonly Dictionary<string, object> values = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
    public object this[string key]
    {
        get => values.TryGetValue(key, out var value) ? value : null;
        set { if (value == null) values.Remove(key); else values[key] = value; }
    }
    public T Get<T>(string key, T fallback = default) => this[key] is T typed ? typed : fallback;
    public int this[string key, int fallback] => Get(key, fallback);
    public int Count => values.Count;
}

public static class Program
{
    private static string Show<T>(IEnumerable<T> items) => "[" + string.Join(",", items) + "]";

    public static void Main()
    {
        int[] numbers = Enumerable.Range(0, 10).ToArray();
        Console.WriteLine(Show(numbers[2..5]) + Show(numbers[..3]) + Show(numbers[7..]) + Show(numbers[^3..]) + Show(numbers[1..^6]) + Show(numbers[..]) + numbers[^1] + numbers[^10]);
        Index last = ^1;
        Range middle = 3..^3;
        Index fromStart = 2;
        Console.WriteLine(numbers[last] + " " + Show(numbers[middle]) + " " + middle.Start + " " + middle.End + " " + last.IsFromEnd + " " + last.Value + " " + fromStart + " " + middle.GetOffsetAndLength(10));
        string text = "the quick brown fox";
        Console.WriteLine(text[4..9] + "|" + text[^3..] + "|" + text[..3] + "|" + text[^1] + "|" + text[4..9][1..^1] + "|" + text.AsSpan()[10..15].ToString());
        var list = new List<int>(numbers);
        Console.WriteLine(list[^2] + " " + Show(list.GetRange(2, 3)) + " " + Show(numbers.AsSpan(1, 4)[1..^1].ToArray()));
        try { Console.WriteLine(numbers[5..2].Length); }
        catch (ArgumentOutOfRangeException) { Console.WriteLine("bad range"); }
        int start = 2, length = 3;
        Console.WriteLine(Show(numbers[start..(start + length)]) + Show(numbers[^length..^(length - 2)]));

        var grid = new Grid<int>(3, 4);
        for (int row = 0; row < grid.Rows; row++)
            for (int column = 0; column < grid.Columns; column++)
                grid[row, column] = row * 10 + column;
        grid[(1, 1)] += 100;
        grid[2, 3]++;
        grid[0, 0] = grid[(2, 2)] * 2;
        Console.WriteLine(Show(grid[0]) + Show(grid[1]) + Show(grid[2]) + " " + grid[^1, ^1] + " " + grid[^3, 1]);
        try { grid[3, 0] = 1; }
        catch (ArgumentOutOfRangeException e) { Console.WriteLine("out: " + e.ParamName); }

        var sentence = new Sentence(text);
        Console.WriteLine(sentence[1..3] + "|" + sentence[^1] + "|" + sentence[..^1] + "|" + sentence[1..][..1].Length);

        var registry = new Registry { ["Name"] = "sharp", ["Size"] = 42, ["Ratio"] = 1.5 };
        registry["name"] = "forge";
        registry["ratio"] = null;
        Console.WriteLine(registry["NAME"] + " " + registry.Get<int>("size") + " " + registry.Get("missing", "none") + " " + registry["size", 7] + " " + registry["nothing", 7] + " " + registry.Count + " " + (registry["ratio"] ?? "gone"));

        var builder = new StringBuilder("abcdef");
        builder[0] = 'A';
        builder[^1] = 'F';
        var jagged = new int[3][];
        for (int i = 0; i < jagged.Length; i++) jagged[i] = new int[i + 1];
        jagged[2][^1] = 9;
        jagged[1][0]--;
        var cube = new int[2, 3, 4];
        cube[1, 2, 3] = 5;
        cube[0, 0, 0] += cube[1, 2, 3] << 2;
        Console.WriteLine(builder + " " + string.Concat(jagged.Select(Show)) + " " + cube[0, 0, 0] + " " + cube.Length + " " + cube.Rank + " " + cube.GetLength(2));
        var dictionary = new Dictionary<(int, string), List<int>> { [(1, "a")] = new List<int> { 1 } };
        dictionary[(1, "a")].Add(2);
        dictionary[(2, "b")] = new List<int>();
        dictionary[(1, "a")][0] += 40;
        Console.WriteLine(Show(dictionary[(1, "a")]) + dictionary.Count);
    }
}
