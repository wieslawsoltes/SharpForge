using System;
public interface ILogger
{
    static int Created { get; private set; }
    static ILogger Create() { Created++; return new ListLogger(); }
}
public sealed class ListLogger : ILogger { }
public static class Program
{
    public static void Main()
    {
        ILogger plain = ILogger.Create();
        Console.WriteLine(ILogger.Created + " " + (plain != null));
    }
}
