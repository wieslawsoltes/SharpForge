using System;
public enum Access { None = 0, Read = 1, Write = 2 }
public static class Program
{
    const long Big = 5;
    static string Kind(object o) => o switch { 5 => "five", Access.Write => "write", 'c' => "char c", 2.5 => "2.5", true => "yes", "s" => "text", null => "null", _ => "other" };
    static bool IsFive<T>(T value) => value is 5;
    public static void Main()
    {
        object flags = Access.Read, five = 5, longFive = 5L;
        Console.WriteLine((flags is Access.Read) + " " + (flags is Access.Write) + " " + (five is 5) + " " + (longFive is 5) + " " + (longFive is Big) + " " + (five is Big));
        Console.WriteLine(string.Join(",", Kind(5), Kind(5L), Kind(Access.Write), Kind(2), Kind('c'), Kind(2.5), Kind(true), Kind("s"), Kind(null), Kind(Access.Read)));
        Console.WriteLine(IsFive(5) + " " + IsFive(6) + " " + IsFive("5") + " " + IsFive(5L));
        IComparable comparable = 5;
        ValueType boxed = Access.Write;
        Console.WriteLine((comparable is 5) + " " + (boxed is Access.Write) + " " + (boxed is Access.Read));
    }
}
