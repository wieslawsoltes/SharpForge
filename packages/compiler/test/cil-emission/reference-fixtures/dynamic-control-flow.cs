using System;
using System.Collections;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;

class Resource : IDisposable, IAsyncDisposable
{
    readonly string name;
    public Resource(string name) { this.name = name; Console.WriteLine("new:" + name); }
    public void Dispose() { Console.WriteLine("dispose:" + name); }
    public ValueTask DisposeAsync() { Console.WriteLine("async-dispose:" + name); return default; }
}

class Awaitable
{
    public Awaiter GetAwaiter() { return new Awaiter(); }
}

class Awaiter : INotifyCompletion
{
    bool done;
    public bool IsCompleted { get { return done; } }
    public void OnCompleted(Action continuation) { done = true; continuation(); }
    public int GetResult() { return done ? 17 : -1; }
}

class CriticalAwaitable
{
    public CriticalAwaiter GetAwaiter() { return new CriticalAwaiter(); }
}

class CriticalAwaiter : ICriticalNotifyCompletion
{
    public bool IsCompleted { get { return false; } }
    public void OnCompleted(Action continuation) { throw new Exception("wrong completion protocol"); }
    public void UnsafeOnCompleted(Action continuation) { continuation(); }
    public int GetResult() { return 23; }
}

class Program
{
    static dynamic Fail() { Console.WriteLine("acquire-fail"); throw new InvalidOperationException(); }
    static dynamic Values() { return new object[] { 1, (short)2, (byte)3 }; }
    static async Task<int> Later() { await Task.Yield(); return 9; }
    static async Task NoResult() { await Task.Yield(); Console.WriteLine("void-result"); }
    static async Task Main()
    {
        foreach (long value in Values()) Console.WriteLine(value);
        dynamic items = new int[] { 4, 5 };
        foreach (var value in items) Console.WriteLine((object)(value + 1));
        dynamic resource = new Resource("expression");
        using (resource) Console.WriteLine("using-body");
        try
        {
            using (dynamic first = new Resource("first"), second = Fail()) Console.WriteLine("unreachable");
        }
        catch (InvalidOperationException) { Console.WriteLine("acquisition-caught"); }
        {
            using dynamic local = new Resource("declaration");
            Console.WriteLine("declaration-body");
        }
        dynamic missing = null;
        using (missing) Console.WriteLine("null-resource");
        dynamic asynchronous = new Resource("asynchronous");
        await using (asynchronous) Console.WriteLine("async-body");
        dynamic immediate = Task.FromResult(7);
        Console.WriteLine((object)(await immediate));
        dynamic pending = Later();
        Console.WriteLine(100 + (int)(await pending));
        dynamic ordinary = new Awaitable();
        Console.WriteLine((object)(await ordinary));
        dynamic critical = new CriticalAwaitable();
        Console.WriteLine((object)(await critical));
        dynamic noResult = NoResult();
        await noResult;
        Console.WriteLine("done");
    }
}
