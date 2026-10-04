using System;
using System.Threading.Tasks;

class Program
{
    static async Task Plain() { await Task.CompletedTask; Console.WriteLine("plain"); }
    static async Task<int> Number() { return await Task.FromResult(41) + 1; }
    static async Task<string> Text() { return await Task.FromResult("result"); }
    static async Task Main()
    {
        await Plain();
        Console.WriteLine(await Number());
        Console.WriteLine(await Text());
    }
}
