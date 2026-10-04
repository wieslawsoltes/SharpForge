using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

public struct Counter
{
    public int Value;
    public (int Low, int High) Range;
}

public sealed class Account
{
    private int balance = 10;
    private static int total;
    private Counter counter;

    public static async Task<int> DelayedAsync(int value)
    {
        await Task.Yield();
        return value;
    }

    public async Task<string> UpdateAsync()
    {
        balance += await DelayedAsync(5);
        total += balance * await DelayedAsync(2);
        counter.Value += await DelayedAsync(3);
        counter.Range.High -= await DelayedAsync(4);
        counter.Value = await DelayedAsync(counter.Value * 2);
        return balance + " " + total + " " + counter.Value + " " + counter.Range.High;
    }
}

public static class Program
{
    static int Sum(params int[] values) => values.Sum();
    static string Join(string separator, params object[] values) => string.Join(separator, values);

    // The old value of a compound assignment is read before the await, as C# orders it.
    static int shared = 1;
    static async Task<int> BumpAndReturnAsync(int value)
    {
        await Task.Yield();
        shared += 100;
        return value;
    }

    public static async Task Main()
    {
        int saved = 3;
        string name = "n";
        Console.WriteLine($"saved {saved}, name {name,-3}|, again {await Account.DelayedAsync(7)}, last {await Account.DelayedAsync(8):D3}");
        Console.WriteLine(Sum(1, await Account.DelayedAsync(2), 3, await Account.DelayedAsync(4)) + " " + Join("-", name, await Account.DelayedAsync(5), saved));
        int[] array = { saved, await Account.DelayedAsync(6), saved * 2, await Account.DelayedAsync(7) };
        var list = new List<int> { 1, await Account.DelayedAsync(2) };
        Console.WriteLine(string.Join(",", array) + " " + list.Count + " " + new[] { await Account.DelayedAsync(1) }.Length);
        Console.WriteLine(await new Account().UpdateAsync());
        var counter = new Counter();
        var tuple = (Count: 1, Label: "t");
        for (int i = 1; i <= 3; i++)
        {
            counter.Value += await Account.DelayedAsync(i);
            tuple.Count *= await Account.DelayedAsync(i + 1);
            tuple.Label += await Account.DelayedAsync(i);
            saved -= await Account.DelayedAsync(1);
        }
        shared += await BumpAndReturnAsync(5);
        Console.WriteLine(counter.Value + " " + tuple + " " + saved + " " + shared);
    }
}
