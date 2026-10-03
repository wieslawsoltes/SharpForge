using System;

[Flags]
enum Choice : uint { None = 0, A = 1, B = 2, High = 0x80000000 }

static class Program
{
    static void Main()
    {
        object boxed = Choice.A;
        Console.WriteLine(boxed);
        Console.WriteLine(boxed is Choice);
        Console.WriteLine(boxed is Enum);
        Console.WriteLine(boxed is int);
        Console.WriteLine(((Choice)boxed).HasFlag(Choice.A));
        Console.WriteLine(Choice.A | Choice.High);
        string literal = "a";
        string runtime = new string(new[] { 'a' });
        Console.WriteLine(object.ReferenceEquals(literal, "a"));
        Console.WriteLine(object.ReferenceEquals(literal, runtime));
        Console.WriteLine(object.ReferenceEquals(literal, string.Intern(runtime)));
        Console.WriteLine(object.ReferenceEquals("", new string((char[])null)));
        Console.WriteLine(object.ReferenceEquals("", new string(new char[0])));
        string pair = "😀";
        Console.WriteLine((int)pair[0]);
        Console.WriteLine((int)pair[1]);
    }
}
