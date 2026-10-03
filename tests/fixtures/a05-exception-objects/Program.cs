using System;
using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;
static class Program {
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Origin() { throw new InvalidOperationException("origin"); }
    [MethodImpl(MethodImplOptions.NoInlining)]
    static Exception Caught(bool reset) {
        try {
            try { Origin(); }
            catch (Exception error) { if (reset) throw error; throw; }
        } catch (Exception error) { return error; }
        return null;
    }
    static void Main() {
        var preserved = Caught(false);
        var reset = Caught(true);
        Console.WriteLine(preserved.StackTrace.Contains("Origin"));
        Console.WriteLine(reset.StackTrace.Contains("Origin"));
        var dispatch = ExceptionDispatchInfo.Capture(preserved);
        try { dispatch.Throw(); }
        catch (Exception error) { Console.WriteLine(error.StackTrace.Contains("Origin")); }
        var outer = new Exception("outer", preserved);
        Console.WriteLine(outer.InnerException.Message);
        Console.WriteLine(outer.GetBaseException() == preserved);
        outer.HResult = 42;
        Console.WriteLine(outer.HResult);
        outer.Data["payload"] = "retained";
        Console.WriteLine(outer.Data["payload"]);
        var nested = new AggregateException(new Exception("a"), new Exception("b"));
        var flattened = new AggregateException(nested, new Exception("c")).Flatten();
        Console.WriteLine(flattened.InnerExceptions.Count);
        Console.WriteLine(flattened.InnerExceptions[0].Message);
        Console.WriteLine(flattened.InnerExceptions[1].Message);
        Console.WriteLine(flattened.InnerExceptions[2].Message);
    }
}
