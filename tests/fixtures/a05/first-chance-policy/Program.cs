using System;
using System.Runtime.ExceptionServices;

static class Program
{
    static Exception original = new InvalidOperationException("original");
    static void First(object sender, FirstChanceExceptionEventArgs args)
    {
        Console.WriteLine("first:" + args.Exception.Message);
        if (!Object.ReferenceEquals(args.Exception, original)) return;
        try { throw new Exception("subscriber"); }
        finally { Console.WriteLine("cleanup"); }
    }

    static void Second(object sender, FirstChanceExceptionEventArgs args)
    {
        GC.Collect();
        Console.WriteLine("second:" + args.Exception.Message);
    }

    static void Last(object sender, UnhandledExceptionEventArgs args)
    {
        Console.WriteLine("unhandled");
    }

    static void Main()
    {
        AppDomain.CurrentDomain.FirstChanceException += First;
        AppDomain.CurrentDomain.FirstChanceException += Second;
        AppDomain.CurrentDomain.UnhandledException += Last;
        try { throw original; }
        catch (Exception caught)
        {
            Console.WriteLine("caught");
            Console.WriteLine(Object.ReferenceEquals(caught, original));
            Console.WriteLine(caught.Message);
        }
    }
}
