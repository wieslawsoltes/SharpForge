using System;

class Program
{
    static void Main()
    {
        Span<int> values = stackalloc int[4] { 1, 2, 3, 4 };
        Span<int> middle = values.Slice(1, 2);
        middle[0] = 12;
        Console.WriteLine(values[1]);
        int[,] grid = new int[2, 3];
        grid[1, 2] = values[1];
        Console.WriteLine(grid[1, 2]);
    }
}
