using System;
using System.Runtime.CompilerServices;

public static class Export
{
    private static int Count;

    [ModuleInitializer]
    internal static void First()
    {
        Count++;
        Console.WriteLine("first");
    }

    [ModuleInitializer]
    internal static void Second()
    {
        Count++;
        Console.WriteLine("second");
    }

    public static int Read()
    {
        Console.WriteLine("read");
        return Count;
    }
}
