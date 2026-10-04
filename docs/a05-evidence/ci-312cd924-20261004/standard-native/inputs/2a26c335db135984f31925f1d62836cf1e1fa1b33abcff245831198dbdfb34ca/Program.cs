using System;
using System.Runtime.ExceptionServices;

class Program
{
    void First(object sender, FirstChanceExceptionEventArgs args)
    {
        Console.WriteLine("first:" + args.Exception.Message);
    }

    static void Second(object sender, FirstChanceExceptionEventArgs args)
    {
        Console.WriteLine("second");
    }

    static void Main()
    {
        Program target = new Program();
        EventHandler<FirstChanceExceptionEventArgs> first = target.First, second = Second;
        Console.WriteLine(first == target.First);
        EventHandler<FirstChanceExceptionEventArgs> combined = first + second + first;
        AppDomain.CurrentDomain.FirstChanceException += combined;
        AppDomain.CurrentDomain.FirstChanceException -= first + second;
        try { throw new Exception("saved"); } catch (Exception) { }
        AppDomain.CurrentDomain.FirstChanceException -= first;
        int calls = 0;
        EventHandler<FirstChanceExceptionEventArgs> capture = (sender, args) => { calls++; };
        AppDomain.CurrentDomain.FirstChanceException += capture;
        try { throw new Exception("counted"); } catch (Exception) { }
        AppDomain.CurrentDomain.FirstChanceException -= capture;
        try { throw new Exception("removed"); } catch (Exception) { }
        Console.WriteLine(calls);
        AppDomain.CurrentDomain.FirstChanceException += target.First;
        AppDomain.CurrentDomain.FirstChanceException += target.First;
        AppDomain.CurrentDomain.FirstChanceException -= target.First;
        AppDomain.CurrentDomain.FirstChanceException += null;
        try { throw new Exception("duplicate"); } catch (Exception) { Console.WriteLine("done"); }
        AppDomain.CurrentDomain.FirstChanceException -= target.First;
    }
}
