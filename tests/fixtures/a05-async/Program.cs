using System;
using System.Collections.Generic;
using System.Threading.Tasks;

static class Program
{
    static int cleanup;
    static int voidResult;
    static async Task<int> Work()
    {
        int value = 20;
        try
        {
            await Task.Delay(5);
            Console.WriteLine("first");
            value += 22;
            await Task.Delay(5);
            Console.WriteLine("second");
            return value;
        }
        finally { cleanup++; Console.WriteLine("finally"); }
    }
    static async Task Fail()
    {
        await Task.Delay(1);
        throw new Exception("awaited-error");
    }
    static async Task CatchFailure()
    {
        try { await Fail(); }
        catch (Exception error) { Console.WriteLine(error.Message); }
        finally { Console.WriteLine("failure-finally"); }
    }
    static async void SetVoid()
    {
        await Task.Delay(1);
        voidResult = 7;
    }
    static async Task YieldTwice()
    {
        await Task.Yield();
        await Task.Yield();
        Console.WriteLine("yielded");
    }
    static async Task<T> Echo<T>(T value)
    {
        await Task.Delay(1);
        return value;
    }
    static IEnumerable<int> Values()
    {
        try { yield return 3; yield return 4; }
        finally { Console.WriteLine("iterator-finally"); }
    }
    static void Main()
    {
        Console.WriteLine(Work().GetAwaiter().GetResult());
        Console.WriteLine(cleanup);
        CatchFailure().GetAwaiter().GetResult();
        SetVoid();
        while (voidResult == 0) Task.Delay(1).GetAwaiter().GetResult();
        Console.WriteLine(voidResult);
        YieldTwice().GetAwaiter().GetResult();
        Console.WriteLine(Echo(9).GetAwaiter().GetResult());
        foreach (int value in Values()) Console.WriteLine(value);
        foreach (int value in Values()) { Console.WriteLine(value); break; }
    }
}
