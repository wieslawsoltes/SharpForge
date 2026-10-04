using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public static class Matrix
{
    public static int[,] Multiply(int[,] a, int[,] b)
    {
        int rows = a.GetLength(0), columns = b.GetLength(1), inner = a.GetLength(1);
        if (inner != b.GetLength(0)) throw new ArgumentException("shape");
        var result = new int[rows, columns];
        for (int i = 0; i < rows; i++)
            for (int j = 0; j < columns; j++)
                for (int k = 0; k < inner; k++)
                    result[i, j] += a[i, k] * b[k, j];
        return result;
    }

    public static T[,] Transpose<T>(T[,] m)
    {
        var result = new T[m.GetLength(1), m.GetLength(0)];
        for (int i = 0; i < m.GetLength(0); i++)
            for (int j = 0; j < m.GetLength(1); j++)
                result[j, i] = m[i, j];
        return result;
    }

    public static string Show<T>(T[,] m)
    {
        var text = new StringBuilder();
        for (int i = 0; i < m.GetLength(0); i++)
        {
            text.Append(i == 0 ? "[" : " [");
            for (int j = 0; j < m.GetLength(1); j++) text.Append(j == 0 ? "" : " ").Append(m[i, j]);
            text.Append(']');
        }
        return text.ToString();
    }

    public static double Determinant(double[][] m)
    {
        int n = m.Length;
        var a = m.Select(row => (double[])row.Clone()).ToArray();
        double det = 1;
        for (int column = 0; column < n; column++)
        {
            int pivot = column;
            for (int row = column + 1; row < n; row++) if (Math.Abs(a[row][column]) > Math.Abs(a[pivot][column])) pivot = row;
            if (a[pivot][column] == 0) return 0;
            if (pivot != column) { (a[pivot], a[column]) = (a[column], a[pivot]); det = -det; }
            det *= a[column][column];
            for (int row = column + 1; row < n; row++)
            {
                double factor = a[row][column] / a[column][column];
                for (int k = column; k < n; k++) a[row][k] -= factor * a[column][k];
            }
        }
        return det;
    }

    public static int[][] Pascal(int rows)
    {
        var triangle = new int[rows][];
        for (int i = 0; i < rows; i++)
        {
            triangle[i] = new int[i + 1];
            triangle[i][0] = triangle[i][i] = 1;
            for (int j = 1; j < i; j++) triangle[i][j] = triangle[i - 1][j - 1] + triangle[i - 1][j];
        }
        return triangle;
    }

    public static int[,] Spiral(int size)
    {
        var grid = new int[size, size];
        int value = 1, top = 0, left = 0, bottom = size - 1, right = size - 1;
        while (top <= bottom && left <= right)
        {
            for (int j = left; j <= right; j++) grid[top, j] = value++;
            top++;
            for (int i = top; i <= bottom; i++) grid[i, right] = value++;
            right--;
            for (int j = right; j >= left && top <= bottom; j--) grid[bottom, j] = value++;
            bottom--;
            for (int i = bottom; i >= top && left <= right; i--) grid[i, left] = value++;
            left++;
        }
        return grid;
    }
}

public static class Program
{
    private static void Sort<T>(T[] items, Comparison<T> compare)
    {
        for (int i = 1; i < items.Length; i++)
        {
            T current = items[i];
            int j = i - 1;
            for (; j >= 0 && compare(items[j], current) > 0; j--) items[j + 1] = items[j];
            items[j + 1] = current;
        }
    }

    private static int BinarySearch(int[] sorted, int target)
    {
        int low = 0, high = sorted.Length - 1;
        while (low <= high)
        {
            int mid = low + (high - low) / 2;
            if (sorted[mid] == target) return mid;
            if (sorted[mid] < target) low = mid + 1; else high = mid - 1;
        }
        return ~low;
    }

    public static void Main()
    {
        int[,] a = { { 1, 2, 3 }, { 4, 5, 6 } }, b = { { 7, 8 }, { 9, 10 }, { 11, 12 } };
        Console.WriteLine(Matrix.Show(Matrix.Multiply(a, b)) + " | " + Matrix.Show(Matrix.Transpose(a)) + " | " + Matrix.Show(Matrix.Multiply(b, a)));
        try { Matrix.Multiply(a, a); } catch (ArgumentException e) { Console.WriteLine(e.Message); }
        Console.WriteLine(Matrix.Determinant(new[] { new[] { 2.0, 0, 0 }, new[] { 0, 3.0, 0 }, new[] { 0, 0, 4.0 } }) + " " + Matrix.Determinant(new[] { new[] { 0.0, 1 }, new[] { 1, 0.0 } }) + " " + Math.Round(Matrix.Determinant(new[] { new[] { 1.0, 2, 3 }, new[] { 4, 5.0, 6 }, new[] { 7, 8, 10.0 } }), 6) + " " + Matrix.Determinant(new[] { new[] { 1.0, 2 }, new[] { 2, 4.0 } }));
        Console.WriteLine(string.Join(" / ", Matrix.Pascal(6).Select(row => string.Join(" ", row))) + " " + Matrix.Pascal(10)[9].Sum());
        Console.WriteLine(Matrix.Show(Matrix.Spiral(4)) + " " + Matrix.Show(Matrix.Spiral(1)));
        string[,] names = { { "a", "b" }, { "c", "d" } };
        Console.WriteLine(Matrix.Show(Matrix.Transpose(names)) + " " + a.Rank + a.Length + a.GetLength(0) + a.GetUpperBound(1) + " " + a.Cast<int>().Sum() + " " + string.Join("", b.Cast<int>().Where(v => v % 2 == 0)));
        int total = 0;
        foreach (int value in a) total = total * 2 + value;
        Console.WriteLine(total);

        int[] numbers = { 5, 3, 9, 1, 7, 3 };
        var copy = (int[])numbers.Clone();
        Sort(copy, (x, y) => x - y);
        var words = new[] { "pear", "Apple", "fig", "apple" };
        Sort(words, string.CompareOrdinal);
        Console.WriteLine(string.Join(",", copy) + " " + string.Join(",", numbers) + " " + string.Join(",", words) + " " + BinarySearch(copy, 7) + BinarySearch(copy, 4) + BinarySearch(copy, 100) + " " + Array.IndexOf(numbers, 3) + Array.LastIndexOf(numbers, 3) + Array.IndexOf(numbers, 42));
        Array.Reverse(copy);
        Array.Resize(ref copy, 8);
        Array.Copy(numbers, 0, copy, 6, 2);
        var filled = new double[4];
        Array.Fill(filled, 1.5);
        Array.Clear(copy, 0, 2);
        Console.WriteLine(string.Join(",", copy) + " " + filled.Sum() + " " + Array.Exists(copy, v => v > 8) + " " + Array.TrueForAll(copy, v => v >= 0) + " " + Array.Find(copy, v => v > 4) + " " + Array.FindLastIndex(copy, v => v == 3) + " " + Array.Empty<string>().Length + " " + new int[0].Length + " " + new int[2, 0].Length);
        var jagged = new List<int>[3];
        for (int i = 0; i < jagged.Length; i++) jagged[i] = new List<int>(Enumerable.Range(0, i + 1));
        jagged[2][1] *= 50;
        long[] longs = { 1, 2, int.MaxValue };
        object[] objects = { 1, "two", 3.0, null, new[] { 4 } };
        char[][] board = { "abc".ToCharArray(), "def".ToCharArray() };
        board[1][1] = char.ToUpper(board[0][2]);
        (board[0], board[1]) = (board[1], board[0]);
        Console.WriteLine(string.Join("|", jagged.Select(l => string.Join("", l))) + " " + longs.Sum() + " " + objects.Count(o => o is not null and not string) + " " + new string(board[0]) + new string(board[1]) + " " + (objects[4] is int[] { Length: 1 }) + " " + new[] { 1, 2, 3 }.GetType().Name + new[] { 1.5, 2 }.GetType().Name + new[,] { { "x" } }.GetType().Name);
        try { objects[5] = 1; } catch (IndexOutOfRangeException) { Console.WriteLine("index"); }
        try { var negative = new int[numbers[3] - 2]; } catch (OverflowException) { Console.WriteLine("negative size"); }
    }
}
