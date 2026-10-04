using System;
using System.Collections.Generic;
using System.IO;

class AppException : Exception
{
    public int Code { get; }
    public AppException(string message, int code, Exception inner) : base(message, inner) { Code = code; }
}

class Program
{
    static void Throw(int kind)
    {
        switch (kind)
        {
            case 0: throw new ArgumentNullException("value");
            case 1: throw new ArgumentOutOfRangeException("index", 5, "too big");
            case 2: throw new InvalidOperationException("bad state");
            case 3: throw new KeyNotFoundException();
            case 4: throw new FormatException("format", new Exception("inner"));
            case 5: throw new NotSupportedException();
            case 6: throw new FileNotFoundException("missing", "a.txt");
            case 7: throw new AppException("app", 7, new TimeoutException("slow"));
            default: throw new ObjectDisposedException("stream");
        }
    }

    static void Main()
    {
        for (int kind = 0; kind < 9; kind++)
        {
            try { Throw(kind); }
            catch (ArgumentOutOfRangeException e) { Console.WriteLine("range " + e.ParamName + " " + e.ActualValue); }
            catch (ArgumentException e) { Console.WriteLine("argument " + e.ParamName); }
            catch (ObjectDisposedException e) { Console.WriteLine("disposed " + e.ObjectName); }
            catch (InvalidOperationException e) { Console.WriteLine("invalid " + e.Message); }
            catch (FileNotFoundException e) { Console.WriteLine("file " + e.FileName); }
            catch (IOException) { Console.WriteLine("io"); }
            catch (AppException e) when (e.Code == 7) { Console.WriteLine("app " + e.InnerException.GetType().Name + " " + e.InnerException.Message); }
            catch (SystemException e) { Console.WriteLine("system " + e.GetType().FullName + " " + (e.InnerException?.Message ?? "-")); }
        }

        try { object o = "text"; Console.WriteLine((int)o); }
        catch (InvalidCastException) { Console.WriteLine("cast"); }
        try { int[] xs = new int[1]; xs[2] = 1; }
        catch (IndexOutOfRangeException) { Console.WriteLine("index"); }
        try { string s = null; Console.WriteLine(s.Length); }
        catch (NullReferenceException) { Console.WriteLine("null"); }
        try { int zero = 0; Console.WriteLine(1 / zero); }
        catch (DivideByZeroException e) { Console.WriteLine(e is ArithmeticException); }
        try { throw new AggregateException(new Exception("one"), new Exception("two")); }
        catch (AggregateException e) { Console.WriteLine(e.InnerExceptions.Count); }
        try { object nothing = null; ArgumentNullException.ThrowIfNull(nothing, "thing"); }
        catch (ArgumentNullException e) { Console.WriteLine(e.ParamName); }
    }
}
