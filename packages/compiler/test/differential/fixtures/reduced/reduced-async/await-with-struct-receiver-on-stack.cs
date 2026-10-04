using System;
using System.Threading.Tasks;

public readonly struct Rate
{
    private readonly decimal factor;
    public Rate(decimal factor) { this.factor = factor; }
    public async Task<decimal> ApplyAsync(decimal amount) { await Task.Yield(); return amount * factor; }
    public decimal Apply(decimal amount) => amount * factor;
}

public struct Counter
{
    public int Total;
    public int Add(int amount) { Total += amount; return Total; }
}

public static class Program
{
    private static async Task<int> LaterAsync(int value) { await Task.Yield(); return value; }

    public static async Task Main()
    {
        Rate tax = new Rate(1.2m), discount = new Rate(0.5m);
        // The receiver of the second call is the address of a struct local, already on the stack at the inner await.
        decimal figure = await tax.ApplyAsync(100m) + await discount.ApplyAsync(await tax.ApplyAsync(10m));
        Console.WriteLine(figure);
        Console.WriteLine(discount.Apply(await tax.ApplyAsync(await LaterAsync(5))));

        // The address is taken again after the suspension: the call still mutates the variable itself.
        Counter counter = new Counter();
        int first = counter.Add(await LaterAsync(3));
        int second = counter.Add(await LaterAsync(4)) + counter.Add(await LaterAsync(5));
        Console.WriteLine(first + " " + second + " " + counter.Total);

        int number = 7;
        Console.WriteLine(number.CompareTo(await LaterAsync(7)) + " " + number.ToString(await Task.FromResult("D3")));
        for (int round = 0; round < 3; round++)
        {
            Counter local = new Counter { Total = round };
            Console.WriteLine(local.Add(await LaterAsync(10)) + local.Add(await LaterAsync(round)));
        }
    }
}
