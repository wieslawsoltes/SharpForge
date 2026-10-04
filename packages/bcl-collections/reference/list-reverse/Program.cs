using System;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        var empty = new List<int>();
        empty.Reverse();
        Console.WriteLine(empty.Count);
        Console.WriteLine(empty.Capacity);
        empty.Capacity = 8;
        empty.Reverse();
        Console.WriteLine(empty.Capacity);
        empty.Add(7);
        empty.Reverse();
        Console.WriteLine(empty[0]);

        var values = new List<int>(8);
        values.AddRange(new int[] { 1, 2, 3, 4, 5 });
        var copy = values.ToArray();
        values.Reverse();
        Console.WriteLine(String.Join(",", values.ToArray()));
        Console.WriteLine(values.Count);
        Console.WriteLine(values.Capacity);
        Console.WriteLine(String.Join(",", copy));
        values.Reverse();
        Console.WriteLine(String.Join(",", values.ToArray()));
        values.Add(6);
        values.Reverse();
        Console.WriteLine(String.Join(",", values.ToArray()));

        var words = new List<string>(8);
        words.AddRange(new string[] { "first", null, "third", "last" });
        words.Reverse();
        GC.Collect();
        Console.WriteLine(String.Join("|", words.ToArray()));
        Console.WriteLine(words.Count);
        Console.WriteLine(words.Capacity);
        words.Clear();
        words.Reverse();
        Console.WriteLine(words.Count);
        Console.WriteLine(words.Capacity);
    }
}
