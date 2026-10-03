using System;

sealed class Resource : IDisposable
{
    public void Dispose() { Console.WriteLine("disposed"); }
}

static class Program
{
    static int state;
    static int observed;
    static bool Observe(Exception error)
    {
        observed = state;
        Console.WriteLine(error.Message);
        return true;
    }
    static bool BrokenFilter(Exception error)
    {
        Console.WriteLine("filter-failed");
        throw new Exception("ignored-filter-error");
    }
    static void ThrowWithFinally()
    {
        try { throw new Exception("original"); }
        finally { state = 1; Console.WriteLine("cleanup"); }
    }
    static void Rethrow()
    {
        try { throw new Exception("identity"); }
        catch (Exception) { throw; }
    }
    static void WithResource()
    {
        using (Resource resource = new Resource()) { throw new Exception("resource"); }
    }
    static void Main()
    {
        try { ThrowWithFinally(); }
        catch (Exception error) when (Observe(error)) { Console.WriteLine(observed); Console.WriteLine(state); }
        try { throw new Exception("preserved"); }
        catch (Exception error) when (BrokenFilter(error)) { Console.WriteLine("unreachable"); }
        catch (Exception error) { Console.WriteLine(error.Message); }
        try { WithResource(); }
        catch (Exception error) when (Observe(error)) { Console.WriteLine("resource-caught"); }
        try { Rethrow(); }
        catch (Exception error) { Console.WriteLine(error.Message); }
        try
        {
            try { throw new Exception("before"); }
            finally { throw new Exception("replacement"); }
        }
        catch (Exception error) { Console.WriteLine(error.Message); }
    }
}
