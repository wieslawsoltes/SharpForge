using System;
using System.Threading.Tasks;

class Payload { public string Text; }
class Program
{
    static async Task<T> Keep<T>(T value)
    {
        await Task.Yield();
        return value;
    }

    static async Task Main()
    {
        Console.WriteLine(await Keep(41) + 1);
        Console.WriteLine(await Keep("generic text"));
        Payload payload = new Payload { Text = "same payload" };
        Payload returned = await Keep(payload);
        Console.WriteLine(Object.ReferenceEquals(payload, returned));
        Console.WriteLine(returned.Text);
    }
}
