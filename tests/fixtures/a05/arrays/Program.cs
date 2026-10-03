using System;

struct Pair { public int Number; public string? Text; }
static class Program
{
    static void Bump(ref int value) { GC.Collect(); value += 5; }
    static void Main()
    {
        int[,] matrix = new int[2, 3];
        matrix[1, 2] = 7;
        Bump(ref matrix[1, 2]);
        Console.WriteLine(matrix[1, 2]);
        Console.WriteLine(matrix.Rank);
        Console.WriteLine(matrix.Length);
        Console.WriteLine(matrix.GetLength(1));
        Console.WriteLine(matrix.GetUpperBound(0));
        Console.WriteLine(matrix.LongLength);

        int[] lengths = new int[2]; lengths[0] = 2; lengths[1] = 3;
        int[] lower = new int[2]; lower[0] = -1; lower[1] = 4;
        Array bounded = Array.CreateInstance(typeof(int), lengths, lower);
        bounded.SetValue(33, 0, 6);
        Console.WriteLine(bounded.GetValue(0, 6));
        Console.WriteLine(bounded.GetLowerBound(0));
        Console.WriteLine(bounded.GetUpperBound(1));
        Console.WriteLine(bounded.GetType().Name);

        string[,] strings = new string[1, 1];
        object[,] covariant = strings;
        covariant[0, 0] = "text";
        Console.WriteLine(strings[0, 0]);
        try { covariant[0, 0] = new object(); }
        catch (ArrayTypeMismatchException) { Console.WriteLine("ArrayTypeMismatchException"); }
        try { bounded.GetValue(0); }
        catch (ArgumentException) { Console.WriteLine("ArgumentException"); }
        try { bounded.GetValue(1, 4); }
        catch (IndexOutOfRangeException) { Console.WriteLine("IndexOutOfRangeException"); }
        try { strings.SetValue(new object(), 0, 0); }
        catch (InvalidCastException) { Console.WriteLine("InvalidCastException"); }
        try { bounded.SetValue(1.0, 0, 4); }
        catch (ArgumentException) { Console.WriteLine("ArgumentException"); }
        try { matrix.GetLength(2); }
        catch (IndexOutOfRangeException) { Console.WriteLine("IndexOutOfRangeException"); }

        Pair[,] values = new Pair[1, 2];
        values[0, 1].Number = 9; values[0, 1].Text = "kept";
        Pair copy = values[0, 1];
        Bump(ref values[0, 1].Number);
        Console.WriteLine(copy.Number);
        Console.WriteLine(values[0, 1].Number);
        Console.WriteLine(values[0, 1].Text);
        values.SetValue(null, 0, 1);
        Console.WriteLine(values[0, 1].Number);

        int[,,] cube = new int[2, 1, 3]; cube[1, 0, 2] = 19;
        Console.WriteLine(cube[1, 0, 2]);
        int[,] empty = new int[3, 0];
        Console.WriteLine(empty.Length);
        Console.WriteLine(empty.GetUpperBound(1));
        int[] oneLength = new int[1]; oneLength[0] = 2;
        int[] oneLower = new int[1]; oneLower[0] = -3;
        Array rankOne = Array.CreateInstance(typeof(int), oneLength, oneLower);
        rankOne.SetValue(27, -2);
        Console.WriteLine(rankOne.GetType().Name);
        Console.WriteLine(rankOne.GetValue(-2));
    }
}
