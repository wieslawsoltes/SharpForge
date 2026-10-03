using System;
using System.Collections.Generic;

static class Program
{
    static void Main()
    {
        int[] values = new int[] { 10, 20, 30, 40, 50, 60, 70, 80 };
        Array.Copy(values, 0, values, 1, 7);
        Console.WriteLine(values[2]);
        int[] copy = (int[])values.Clone();
        Array.Clear(copy, 1, 2);
        Console.WriteLine(copy[2]);
        Console.WriteLine(values[2]);
        Console.WriteLine(Array.IndexOf(values, 50));
        Array.Resize(ref copy, 10);
        Console.WriteLine(copy.Length);
        Console.WriteLine(copy[9]);
        int[][] jagged = new int[2][];
        jagged[0] = values;
        Console.WriteLine(jagged[0][7]);

        Array bounded = Array.CreateInstance(typeof(int), new int[] { 3 }, new int[] { 5 });
        bounded.SetValue(11, 6);
        Console.WriteLine(bounded.GetValue(6));
        Console.WriteLine(bounded.GetLowerBound(0));
        Console.WriteLine(bounded.GetUpperBound(0));
        try { int[] vector = (int[])bounded; Console.WriteLine(vector.Length); }
        catch (InvalidCastException) { Console.WriteLine("bounded-type"); }
        object strings = new string[2];
        Console.WriteLine(strings is IEnumerable<object>);
        object integers = new int[2];
        Console.WriteLine(integers is object[]);
        byte[] large = new byte[4_000_000L];
        Console.WriteLine(large.LongLength);
        large[3_999_999L] = 9;
        Console.WriteLine(large[3_999_999L]);
    }
}
