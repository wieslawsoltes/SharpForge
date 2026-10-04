using System;
using System.Threading.Tasks;

struct Pair { public int Value; }
class Program
{
    static async Task<T> Keep<T>(T value)
    {
        await Task.Yield();
        return value;
    }

    static async Task Main()
    {
        Pair result = await Keep(new Pair { Value = 42 });
        Console.WriteLine(result.Value);
    }
}
