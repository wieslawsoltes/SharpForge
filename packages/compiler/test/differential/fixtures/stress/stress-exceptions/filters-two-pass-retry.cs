using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;

public sealed class TransientException : Exception
{
    public int Attempt { get; }
    public TransientException(int attempt) : base("transient failure on attempt " + attempt) { Attempt = attempt; }
}

public sealed class RetryPolicy
{
    private readonly int maxAttempts;
    private readonly List<string> log;
    public int TotalBackoff { get; private set; }
    public int Retries { get; private set; }

    public RetryPolicy(int maxAttempts, List<string> log) { this.maxAttempts = maxAttempts; this.log = log; }

    private bool Trace(string text) { log.Add(text); return true; }

    public T Execute<T>(Func<int, T> action)
    {
        int delay = 10;
        for (int attempt = 1; ; attempt++)
        {
            try { return action(attempt); }
            catch (TransientException e) when (attempt < maxAttempts && Trace("retry#" + e.Attempt + " backoff=" + delay))
            {
                TotalBackoff += delay;
                delay *= 2;
                Retries++;
            }
            finally { log.Add("done#" + attempt); }
        }
    }
}

public static class Program
{
    private static readonly List<string> log = new List<string>();
    private static string Drain() { string text = string.Join(" > ", log); log.Clear(); return text; }
    private static bool Filter(string name, bool result) { log.Add(name + "=" + result); return result; }
    private static bool ThrowingFilter(string name) { log.Add(name + " throws"); throw new NotImplementedException(name); }

    private static void Level3()
    {
        try { log.Add("L3 throw"); throw new InvalidOperationException("deep"); }
        finally { log.Add("L3 finally"); }
    }

    private static void Level2()
    {
        try { Level3(); }
        catch (InvalidOperationException e) when (Filter("L2 filter(" + e.Message + ")", false)) { log.Add("L2 catch"); }
        finally { log.Add("L2 finally"); }
    }

    private static void Level1()
    {
        try { Level2(); }
        catch (Exception e) when (Filter("L1 filter", e is InvalidOperationException)) { log.Add("L1 catch"); }
        finally { log.Add("L1 finally"); }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void OriginSite(string message) => throw new FormatException(message);

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static bool KeepsOrigin(bool rethrow)
    {
        try
        {
            try { OriginSite("origin"); }
            catch (FormatException ex)
            {
                if (rethrow) throw;
                throw ex;
            }
        }
        catch (FormatException outer) { return outer.StackTrace.Contains(nameof(OriginSite)); }
        return false;
    }

    private static string Describe(Exception e) => e.GetType().Name + "(" + e.Message + ")" + (e.InnerException != null ? " <- " + Describe(e.InnerException) : "");

    public static void Main()
    {
        Level1();
        Console.WriteLine(Drain());

        int state = 0;
        try
        {
            try { state = 1; throw new ArgumentException("bad id", "id"); }
            catch (ArgumentException) when (ThrowingFilter("filter-A")) { log.Add("A"); }
            catch (ArgumentException e) when (state++ == 1 && e is { ParamName: "id" }) { log.Add("B state=" + state); throw; }
            catch (Exception) { log.Add("C"); }
            finally { log.Add("inner finally"); }
        }
        catch (ArgumentException e) when (e.ParamName == "id") { log.Add("outer caught param=" + e.ParamName); }
        Console.WriteLine(Drain());

        Console.WriteLine("throw; keeps origin: " + KeepsOrigin(true) + ", throw ex; keeps origin: " + KeepsOrigin(false));

        ExceptionDispatchInfo captured = null;
        try { OriginSite("captured"); }
        catch (FormatException e) { captured = ExceptionDispatchInfo.Capture(e); }
        try { log.Add("later"); captured.Throw(); }
        catch (FormatException e) { log.Add("rethrown " + e.Message + " same=" + ReferenceEquals(e, captured.SourceException) + " origin=" + e.StackTrace.Contains(nameof(OriginSite))); }
        Console.WriteLine(Drain());

        try
        {
            try { throw new InvalidOperationException("first"); }
            finally { log.Add("finally replaces"); OriginSite("from finally"); }
        }
        catch (Exception e) { log.Add(Describe(e)); }
        Console.WriteLine(Drain());
        try
        {
            try { throw new KeyNotFoundException("missing key"); }
            catch (KeyNotFoundException e) { log.Add("wrapping"); throw new InvalidOperationException("lookup failed", e); }
            finally { log.Add("finally after catch-throw"); }
        }
        catch (InvalidOperationException e) { log.Add(Describe(e)); }
        Console.WriteLine(Drain());

        var policy = new RetryPolicy(4, log);
        int value = policy.Execute(attempt => attempt < 3 ? throw new TransientException(attempt) : attempt * 100);
        Console.WriteLine("value=" + value + " retries=" + policy.Retries + " backoff=" + policy.TotalBackoff);
        Console.WriteLine(Drain());

        try { policy.Execute<string>(attempt => throw new TransientException(attempt)); }
        catch (TransientException e) { log.Add("gave up: " + e.Message); }
        Console.WriteLine("retries=" + policy.Retries + " backoff=" + policy.TotalBackoff);
        Console.WriteLine(Drain());

        try
        {
            policy.Execute(attempt =>
            {
                if (attempt == 1) throw new TransientException(attempt);
                if (attempt == 2) throw new UnauthorizedAccessException("fatal on attempt " + attempt);
                return attempt;
            });
        }
        catch (Exception e) when (e is not TransientException) { log.Add("fatal: " + Describe(e)); }
        Console.WriteLine("retries=" + policy.Retries + " backoff=" + policy.TotalBackoff);
        Console.WriteLine(Drain());

        var seen = new List<string>();
        foreach (object input in new object[] { 4, 0, "x", null, 7L })
        {
            try
            {
                int n = (int)input;
                seen.Add((100 / n).ToString());
            }
            catch (DivideByZeroException) { seen.Add("div0"); }
            catch (InvalidCastException) when (input is string) { seen.Add("string"); }
            catch (InvalidCastException) { seen.Add("cast"); }
            catch (NullReferenceException) { seen.Add("null"); }
        }
        Console.WriteLine(string.Join(",", seen));
        Console.WriteLine("state=" + state + " pending log entries=" + log.Count);
    }
}
