using System;
using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;

static class Program
{
    static int state;

    static void Inner()
    {
        try { throw new InvalidOperationException("original"); }
        finally { state = 9; Console.WriteLine("inner-finally"); }
    }

    static bool Search(Exception error)
    {
        Console.WriteLine(state);
        return error.Message == "original";
    }

    static bool ThrowingFilter(Exception error)
    {
        Console.WriteLine("throwing-filter");
        throw new ArgumentException("filter failure");
    }

    static int ReturnWithCleanup()
    {
        try
        {
            try
            {
                try { return 42; }
                finally { Console.WriteLine("finally-3"); }
            }
            finally { Console.WriteLine("finally-2"); }
        }
        finally { Console.WriteLine("finally-1"); }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void ThrowOrigin() { throw new Exception("trace"); }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Preserve()
    {
        try { ThrowOrigin(); }
        catch (Exception) { throw; }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Reset()
    {
        try { ThrowOrigin(); }
        catch (Exception error) { throw error; }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Dispatch()
    {
        ExceptionDispatchInfo saved = null;
        try { ThrowOrigin(); }
        catch (Exception error) { saved = ExceptionDispatchInfo.Capture(error); }
        saved.Throw();
    }

    static int Divide(int divisor) { return 1 / divisor; }

    static void Main()
    {
        try { Inner(); }
        catch (Exception error) when (Search(error)) { Console.WriteLine(state); }

        try { throw new InvalidOperationException("filtered"); }
        catch (Exception error) when (ThrowingFilter(error)) { Console.WriteLine("unreachable"); }
        catch (ArgumentException) { Console.WriteLine("wrong sibling"); }
        catch (InvalidOperationException) { Console.WriteLine("fallback"); }

        Console.WriteLine(ReturnWithCleanup());
        try
        {
            try { throw new InvalidOperationException("old"); }
            finally { throw new ArgumentException("replacement"); }
        }
        catch (ArgumentException error) { Console.WriteLine(error.Message); }
        // Select an original handler during first-pass search so CLR unwinds the throwing finally.
        catch (InvalidOperationException) { Console.WriteLine("unreachable original"); }

        try { Console.WriteLine(Divide(0)); }
        catch (ArithmeticException) { Console.WriteLine("arithmetic"); }
        try { string missing = null; Console.WriteLine(missing.Length); }
        catch (SystemException) { Console.WriteLine("system"); }
        try { int[] values = new int[1]; Console.WriteLine(values[2]); }
        catch (InvalidCastException) { Console.WriteLine("wrong cast"); }
        catch (IndexOutOfRangeException) { Console.WriteLine("index"); }

        try { Preserve(); }
        catch (Exception error) { Console.WriteLine(error.StackTrace.Contains("ThrowOrigin")); }
        try { Reset(); }
        catch (Exception error) { Console.WriteLine(error.StackTrace.Contains("ThrowOrigin")); }
        try { Dispatch(); }
        catch (Exception error) { Console.WriteLine(error.StackTrace.Contains("ThrowOrigin")); }

        Exception inner = new ArithmeticException("inner");
        Exception outer = new InvalidOperationException("outer", inner);
        Console.WriteLine(outer.InnerException.Message);
        Console.WriteLine(outer.GetBaseException() == inner);
    }
}
