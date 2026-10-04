using System;
using System.Threading.Tasks;

class Program
{
    static Exception original = new Exception("original");
    static async Task<int> Fail() { await Task.Delay(1); throw original; }
    static void Main()
    {
        Task<int> task = Fail();
        try { task.Wait(); }
        catch (AggregateException error) { Console.WriteLine(Object.ReferenceEquals(original, error.InnerException)); }
        GC.Collect();
        try { Console.WriteLine(task.Result); }
        catch (AggregateException error) { Console.WriteLine(Object.ReferenceEquals(original, error.InnerException)); }
        try { task.GetAwaiter().GetResult(); }
        catch (Exception error) { Console.WriteLine(Object.ReferenceEquals(original, error)); }
        Console.WriteLine(Task.Delay(-1).IsCompleted);
        Console.WriteLine(Task.Delay(0).IsCompleted);
        Console.WriteLine(Task.Delay(Int32.MaxValue).IsCompleted);
        try { Task.Delay(-2); }
        catch (ArgumentOutOfRangeException) { Console.WriteLine("range"); }
    }
}
