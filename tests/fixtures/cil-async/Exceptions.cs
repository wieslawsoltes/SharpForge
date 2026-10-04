using System;
using System.Threading.Tasks;

class Program
{
    static Exception original;
    static async Task Fail(bool suspend)
    {
        try
        {
            if (suspend) await Task.Delay(1);
            throw original;
        }
        finally { Console.WriteLine("finally"); }
    }
    static async Task Observe(bool suspend)
    {
        original = new Exception("original");
        Task task = Fail(suspend);
        try { await task; }
        catch (Exception error) { Console.WriteLine(Object.ReferenceEquals(original, error)); }
        GC.Collect();
        try { await task; }
        catch (Exception error) { Console.WriteLine(Object.ReferenceEquals(original, error)); }
    }
    static async Task Main() { await Observe(false); await Observe(true); }
}
