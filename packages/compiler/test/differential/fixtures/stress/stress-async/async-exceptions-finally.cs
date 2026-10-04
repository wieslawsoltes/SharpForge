using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

public sealed class Step : IAsyncDisposable, IDisposable
{
    private readonly List<string> log;
    private readonly string name;
    private readonly bool failOnDispose;
    public Step(string name, List<string> log, bool failOnDispose = false) { this.name = name; this.log = log; this.failOnDispose = failOnDispose; log.Add("+" + name); }
    public async ValueTask DisposeAsync()
    {
        await Task.Yield();
        log.Add("~" + name);
        if (failOnDispose) throw new InvalidOperationException("dispose " + name);
    }
    public void Dispose() => log.Add("-" + name);
}

public static class Program
{
    private static readonly List<string> log = new List<string>();

    private static async Task<int> ThrowAfterAsync(string message, int delay = 1)
    {
        await Task.Delay(delay);
        throw new InvalidOperationException(message);
    }

    private static async Task<string> NestedAsync(int mode)
    {
        string result = "start";
        try
        {
            log.Add("outer try");
            try
            {
                await Task.Yield();
                if (mode == 1) throw new ArgumentException("inner");
                if (mode == 2) await ThrowAfterAsync("awaited");
                if (mode == 3) return "early";
                result = "completed";
            }
            catch (ArgumentException e)
            {
                log.Add("caught " + e.Message);
                await Task.Yield();
                result = "recovered";
            }
            finally
            {
                await Task.Delay(1);
                log.Add("inner finally");
            }
            log.Add("after inner");
        }
        catch (InvalidOperationException e) when (e.Message.Length > 3)
        {
            log.Add("outer caught " + e.Message);
            await Task.Yield();
            result = "outer";
        }
        finally
        {
            log.Add("outer finally");
        }
        return result;
    }

    private static async Task<int> LoopAsync(int limit)
    {
        int total = 0;
        for (int i = 0; i < limit; i++)
        {
            try
            {
                if (i == 1) continue;
                if (i == 4) break;
                total += await Task.FromResult(i * 10);
                if (i == 3) throw new FormatException();
            }
            catch (FormatException)
            {
                total += 1000;
                await Task.Yield();
            }
            finally
            {
                total++;
                await Task.Yield();
            }
        }
        return total;
    }

    private static async Task UsingAsync(bool fail)
    {
        await using var first = new Step("a", log);
        using var second = new Step("b", log);
        await using (var third = new Step("c", log, failOnDispose: fail))
        {
            await Task.Yield();
            log.Add("body");
        }
        log.Add("after c");
    }

    private static async Task<string> RethrowAsync()
    {
        try
        {
            try { await ThrowAfterAsync("original"); }
            catch (Exception) { log.Add("rethrow"); throw; }
        }
        catch (InvalidOperationException e) { return e.Message + ":" + (e.StackTrace != null); }
        return "unreachable";
    }

    private static async Task VoidLikeAsync(List<string> sink)
    {
        await Task.Yield();
        sink.Add("void-like done");
    }

    private static void Flush(string title)
    {
        Console.WriteLine(title + ": " + string.Join(", ", log));
        log.Clear();
    }

    public static async Task Main()
    {
        for (int mode = 0; mode <= 3; mode++)
        {
            Console.Write(await NestedAsync(mode) + " <- ");
            Flush("mode " + mode);
        }
        Console.WriteLine(await LoopAsync(10) + " " + await LoopAsync(3) + " " + await LoopAsync(0));
        await UsingAsync(false);
        Flush("using");
        try { await UsingAsync(true); }
        catch (InvalidOperationException e) { log.Add("escaped " + e.Message); }
        Flush("using fail");
        Console.WriteLine(await RethrowAsync());
        Flush("rethrow");

        var all = Task.WhenAll(ThrowAfterAsync("first", 1), ThrowAfterAsync("second", 5), Task.FromResult(3));
        try { await all; }
        catch (InvalidOperationException e)
        {
            Console.WriteLine("awaited " + e.Message + "; aggregate " + all.Exception.InnerExceptions.Count + " " + string.Join("+", all.Exception.InnerExceptions.Select(x => x.Message).OrderBy(m => m)) + " " + all.IsFaulted + " " + all.Status);
        }
        var faulted = ThrowAfterAsync("sync wait");
        try { faulted.Wait(); }
        catch (AggregateException e) { Console.WriteLine(e.InnerException.Message + " " + e.Flatten().InnerExceptions.Count); }
        try { _ = faulted.Result; }
        catch (AggregateException e) when (e.InnerException is InvalidOperationException) { Console.WriteLine("result threw"); }
        try { faulted.GetAwaiter().GetResult(); }
        catch (InvalidOperationException) { Console.WriteLine("awaiter unwrapped"); }

        Func<Task> lambda = async () => { await Task.Yield(); throw new NotSupportedException("lambda"); };
        Func<int, Task<int>> guarded = async value =>
        {
            try { return value > 0 ? await Task.FromResult(100 / value) : throw new ArgumentOutOfRangeException(nameof(value)); }
            finally { log.Add("guard " + value); }
        };
        try { await lambda(); } catch (NotSupportedException e) { log.Add(e.Message); }
        log.Add((await guarded(4)).ToString());
        try { await guarded(-1); } catch (ArgumentOutOfRangeException e) { log.Add(e.ParamName); }
        await VoidLikeAsync(log);
        Flush("lambdas");
        var results = new List<string>();
        foreach (var work in new Func<Task<int>>[] { () => Task.FromResult(1), () => ThrowAfterAsync("x"), () => Task.FromCanceled<int>(new System.Threading.CancellationToken(true)), async () => { await Task.Yield(); return 4; } })
        {
            try { results.Add((await work()).ToString()); }
            catch (OperationCanceledException) { results.Add("C"); }
            catch (Exception e) { results.Add("E:" + e.Message); }
        }
        Console.WriteLine(string.Join(" ", results));
    }
}
