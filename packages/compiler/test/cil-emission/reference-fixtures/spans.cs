using System;

class Program
{
    static void Main()
    {
        int[] arr = { 1, 2, 3 };
        Span<int> sp = arr;
        ReadOnlySpan<int> ro = sp;
        ReadOnlySpan<char> chars = "abc";
        { Console.WriteLine(sp.Length); }
        { Console.WriteLine(ro.Length); }
        { Console.WriteLine(chars.Length); }
        { string[] strings = { "x" }; ReadOnlySpan<object> objects = strings; Console.WriteLine(objects.Length); }
        { Console.WriteLine(sp[0]); }
        { sp[1] = 20; Console.WriteLine(arr[1]); }
        { sp[1] += 5; Console.WriteLine(arr[1]); }
        { sp[1]++; Console.WriteLine(arr[1]); }
        { Console.WriteLine(chars[2]); }
        { foreach (var x in ro) Console.WriteLine(x); }
        { foreach (var x in sp) Console.WriteLine(x); }
        { Console.WriteLine(sp.Slice(1).Length); }
        { Console.WriteLine(ro[1..].Length); }
        { Console.WriteLine(sp[^1]); }
        { Console.WriteLine(chars.ToString()); }
        { Console.WriteLine(sp.ToArray().Length); }
        { Console.WriteLine(arr.AsSpan(1, 2).Length); }
        { Console.WriteLine("hello".AsSpan().Slice(1, 3).ToString()); }
        { sp.Fill(7); Console.WriteLine(arr[0]); }
        { sp.Clear(); Console.WriteLine(arr[0]); }
        { Console.WriteLine(sp.IsEmpty || ro.IsEmpty); }
        { Console.WriteLine(chars.SequenceEqual("abc")); }
        { Console.WriteLine(chars.IndexOf('b')); }
        { Console.WriteLine(chars.Contains('c')); }
        { Console.WriteLine(int.Parse("42".AsSpan())); }
        { sp.Reverse(); Console.WriteLine(arr[0]); }
        { ro.CopyTo(sp); Console.WriteLine(sp[2]); }
        { Span<int> empty = default; Console.WriteLine(empty.Length); }
        { ReadOnlySpan<int> fromArray = new[] { 1, 2 }; Console.WriteLine(fromArray.Length); }
        { var copy = new int[3]; arr.CopyTo(copy.AsSpan()); Console.WriteLine(copy[2]); }
        { ref int first = ref sp[0]; first = 9; Console.WriteLine(arr[0]); }
        { Console.WriteLine(string.Concat(chars, "d".AsSpan())); }
        { Memory<int> memory = arr; Console.WriteLine(memory.Span[1] + memory.Length); }
    }
}
