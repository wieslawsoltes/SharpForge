using System;

static class Program
{
    static Exception original = new Exception("terminal");

    static void First(object sender, UnhandledExceptionEventArgs args)
    {
        Console.WriteLine("first");
        try { throw new InvalidOperationException("subscriber"); }
        finally { Console.WriteLine("cleanup"); }
    }

    static void Second(object sender, UnhandledExceptionEventArgs args)
    {
        GC.Collect();
        Console.WriteLine("second");
        Console.WriteLine(Object.ReferenceEquals(args.ExceptionObject, original));
        Console.WriteLine(Object.ReferenceEquals(sender, null));
        Console.WriteLine(args.IsTerminating);
        Console.WriteLine(original.Message);
    }

    static void Main()
    {
        AppDomain.CurrentDomain.UnhandledException += First;
        AppDomain.CurrentDomain.UnhandledException += Second;
        throw original;
    }
}
