using System;
using System.Threading;
using System.Threading.Tasks;
public static class Program
{
    public static async Task Main()
    {
        var local = new AsyncLocal<string> { Value = "outer" };
        string inner = await Task.Run(async () => { string seen = local.Value; local.Value = "changed"; await Task.Yield(); return seen + "/" + local.Value; });
        Console.WriteLine(inner + " " + local.Value);
        int n = await Task.Run(async () => { await Task.Yield(); return 5; });
        Console.WriteLine(n);
    }
}
