using System;
using System.Linq;

[Flags]
public enum Access { None = 0, Read = 1, Write = 2, Execute = 4 }

public sealed class File
{
    public Access Flags;
    public int Size;
    public int?[] Blocks;
}

public static class Program
{
    const int Small = 10, Step = 5;

    // In a subpattern a constant runs up to the conditional operator: `Access.Read | Access.Write` is one constant.
    static string Describe(object value) => value switch
    {
        File { Flags: Access.Read | Access.Write } => "read-write file",
        File { Flags: Access.Read | Access.Write | Access.Execute, Size: Small + Step } => "full file of 15",
        File { Size: Small * 2 or Small << 2 } => "20 or 40",
        File { Size: > Small + Step and < Small * Step } => "between 15 and 50",
        int?[] items => "nullable ints with " + items.Count(item => item is null) + " null",
        int[] { Length: Small - Step * 2 } => "empty ints",
        _ => "other",
    };

    static string Label(int value)
    {
        switch (value)
        {
            case Small | 1: return "eleven";
            case Small + Step when value > 0: return "fifteen";
            case (Small & 2) ^ 3: return "one";
            default: return "none";
        }
    }

    public static void Main()
    {
        object[] values =
        {
            new File { Flags = Access.Read | Access.Write }, new File { Flags = (Access)7, Size = 15 }, new File { Size = 40 }, new File { Size = 30 },
            new File { Size = 3 }, new int?[] { 1, null, null }, new int[0], "text",
        };
        foreach (var value in values) Console.WriteLine(Describe(value));
        Console.WriteLine(Label(11) + Label(15) + Label(1) + Label(2));
        object flags = Access.Read | Access.Execute;
        // After `is` a constant ends before `|`: this is `(flags is Access.Read) | true`.
        Console.WriteLine((flags is Access.Read | true) + " " + (flags is (Access.Read | Access.Execute)) + " " + (flags is Access and (Access.Read | Access.Execute) or Access.None));
    }
}
