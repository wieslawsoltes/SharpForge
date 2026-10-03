using System;
using System.Collections;
using System.Collections.Generic;

static class Program
{
    static IEnumerable<int> Values()
    {
        try { yield return 20; yield return 22; }
        finally { Console.WriteLine("disposed"); }
    }
    static void Main()
    {
        int sum = 0;
        foreach (int value in Values()) { sum += value; }
        Console.WriteLine(sum);
        using (IEnumerator<int> enumerator = Values().GetEnumerator())
        {
            Console.WriteLine(enumerator.MoveNext());
            Console.WriteLine(enumerator.Current);
        }
        IEnumerator<int> reset = Values().GetEnumerator();
        try { ((IEnumerator)reset).Reset(); }
        catch (NotSupportedException) { Console.WriteLine("reset-rejected"); }
        reset.Dispose();
    }
}
