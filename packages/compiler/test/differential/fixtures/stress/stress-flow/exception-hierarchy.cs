using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;

public class DomainException : Exception
{
    public DomainException(string message, int code, Exception inner = null) : base(message, inner) { Code = code; }
    public int Code { get; }
    public override string Message => "[" + Code + "] " + base.Message;
}

public class ValidationException : DomainException
{
    public ValidationException(string field) : base("invalid " + field, 400) { Field = field; }
    public string Field { get; }
}

public sealed class NotFoundException : DomainException
{
    public NotFoundException(string what, Exception inner) : base(what + " not found", 404, inner) { }
}

public sealed class Resource : IDisposable
{
    private readonly List<string> log;
    private readonly string name;
    private bool disposed;
    public Resource(string name, List<string> log, bool failOnCreate = false)
    {
        if (failOnCreate) throw new IOException("cannot open " + name);
        this.name = name;
        this.log = log;
        log.Add("open " + name);
    }
    public void Use(bool fail)
    {
        if (disposed) throw new ObjectDisposedException(name);
        log.Add("use " + name);
        if (fail) throw new InvalidOperationException(name + " failed");
    }
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        log.Add("close " + name);
    }
}

public sealed class AsyncResource : IAsyncDisposable
{
    private readonly List<string> log;
    private readonly string name;
    public AsyncResource(string name, List<string> log) { this.name = name; this.log = log; log.Add("aopen " + name); }
    public async ValueTask DisposeAsync()
    {
        await Task.Yield();
        log.Add("aclose " + name);
    }
}

public static class Program
{
    private static readonly List<string> log = new List<string>();

    private static int Classify(Func<int> action)
    {
        try
        {
            try
            {
                return action();
            }
            catch (ValidationException e) when (e.Field.StartsWith("a"))
            {
                log.Add("filter-a " + e.Field);
                return -1;
            }
            catch (DomainException e) when (Log("filter " + e.Code) && e.Code > 400)
            {
                log.Add("domain>400");
                throw new NotFoundException("wrapped", e);
            }
            finally
            {
                log.Add("inner finally");
            }
        }
        catch (NotFoundException e)
        {
            log.Add("outer " + e.Message + " <- " + e.InnerException.Message);
            return -2;
        }
        catch (Exception e) when (e is not DomainException)
        {
            log.Add("other " + e.GetType().Name);
            return -3;
        }
        finally
        {
            log.Add("outer finally");
        }
    }

    private static bool Log(string entry) { log.Add(entry); return true; }

    private static int FinallyOrder()
    {
        int value = 1;
        try
        {
            using (var first = new Resource("first", log))
            using (var second = new Resource("second", log))
            {
                first.Use(false);
                second.Use(true);
                value = 2;
            }
        }
        catch (InvalidOperationException e)
        {
            log.Add("caught " + e.Message);
            return value;
        }
        finally
        {
            value = 99;
            log.Add("finally sees " + value);
        }
        return -value;
    }

    private static string Rethrow()
    {
        try
        {
            try { throw new ValidationException("zip"); }
            catch (DomainException) { log.Add("rethrowing"); throw; }
        }
        catch (ValidationException e) { return e.Message + "/" + e.Field + "/" + (e.InnerException == null); }
    }

    private static async Task<string> AsyncFlow(bool fail)
    {
        try
        {
            await using var resource = new AsyncResource("async", log);
            using var sync = new Resource("sync", log);
            await Task.Delay(1);
            sync.Use(fail);
            return "ok";
        }
        catch (InvalidOperationException e)
        {
            await Task.Yield();
            return "async caught " + e.Message;
        }
        finally
        {
            log.Add("async finally");
        }
    }

    private static void Flush(string title)
    {
        Console.WriteLine(title + ": " + string.Join(" | ", log));
        log.Clear();
    }

    public static async Task Main()
    {
        Console.WriteLine(Classify(() => 7)); Flush("ok");
        Console.WriteLine(Classify(() => throw new ValidationException("age"))); Flush("validation-a");
        Console.WriteLine(Classify(() => throw new DomainException("gone", 410))); Flush("domain");
        Console.WriteLine(Classify(() => int.Parse("x"))); Flush("format");
        try { Classify(() => throw new ValidationException("zip")); }
        catch (DomainException e) { Console.WriteLine("escaped " + e.Message); }
        Flush("validation-z");
        Console.WriteLine(FinallyOrder()); Flush("using");
        Console.WriteLine(Rethrow()); Flush("rethrow");
        try { using var broken = new Resource("broken", log, failOnCreate: true); }
        catch (IOException e) { Console.WriteLine(e.Message); }
        Console.WriteLine(await AsyncFlow(false)); Flush("async ok");
        Console.WriteLine(await AsyncFlow(true)); Flush("async fail");
        var resource = new Resource("late", log);
        resource.Dispose();
        resource.Dispose();
        try { resource.Use(false); }
        catch (ObjectDisposedException e) { Console.WriteLine(e.ObjectName); }
        try
        {
            try { throw new AggregateException(new ValidationException("x"), new IOException("y")); }
            finally { log.Add("aggregate finally"); }
        }
        catch (AggregateException e)
        {
            e.Handle(inner => inner is DomainException || inner is IOException);
            Console.WriteLine(e.InnerExceptions.Count + " " + e.InnerExceptions[0].Message);
        }
        Flush("end");
        int[] data = new int[2];
        try { checked { data[1] = int.MaxValue; data[0] = data[1] + 1; } }
        catch (OverflowException) { Console.WriteLine("overflow " + data[0]); }
        try { object o = "s"; Console.WriteLine((int)o); }
        catch (InvalidCastException) { Console.WriteLine("cast"); }
        try { Console.WriteLine(data[2]); }
        catch (IndexOutOfRangeException) { Console.WriteLine("index"); }
        try { string s = null; Console.WriteLine(s.Length); }
        catch (NullReferenceException) { Console.WriteLine("null"); }
    }
}
