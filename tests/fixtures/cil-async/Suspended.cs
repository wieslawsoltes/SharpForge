using System;
using System.Threading.Tasks;

class Program
{
    static async Task<int> Work()
    {
        Console.WriteLine("enter");
        await Task.Delay(1);
        Console.WriteLine("first");
        await Task.Yield();
        Console.WriteLine("second");
        return 42;
    }
    static async Task Main()
    {
        Task<int> task = Work();
        Console.WriteLine(task.IsCompleted);
        Console.WriteLine(await task);
        Console.WriteLine(task.IsCompleted);
    }
}
