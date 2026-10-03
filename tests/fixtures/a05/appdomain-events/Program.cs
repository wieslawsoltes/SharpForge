using System;
using System.Runtime.ExceptionServices;
class Program {
    static void First(object sender, FirstChanceExceptionEventArgs args) {
        Console.WriteLine("first:" + args.Exception.Message);
    }
    static void Last(object sender, UnhandledExceptionEventArgs args) {
        Console.WriteLine("unhandled");
        Console.WriteLine(args.IsTerminating);
        Console.WriteLine(Object.ReferenceEquals(sender, AppDomain.CurrentDomain));
    }
    static void Main() {
        AppDomain.CurrentDomain.FirstChanceException += First;
        AppDomain.CurrentDomain.FirstChanceException += First;
        AppDomain.CurrentDomain.FirstChanceException -= First;
        AppDomain.CurrentDomain.UnhandledException += Last;
        try { throw new Exception("caught"); }
        catch (Exception) { Console.WriteLine("caught"); }
        finally { Console.WriteLine("cleanup"); }
        Console.WriteLine("checkpoint");
        throw new Exception("terminal");
    }
}
