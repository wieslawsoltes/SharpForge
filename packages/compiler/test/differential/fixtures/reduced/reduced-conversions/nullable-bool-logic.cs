using System;
public static class Program
{
    static string Show(bool? value) => value.HasValue ? value.Value.ToString() : "null";
    public static void Main()
    {
        bool?[] values = { true, false, null };
        foreach (var a in values)
        {
            foreach (var b in values) Console.Write(Show(a & b) + "/" + Show(a | b) + "/" + Show(a ^ b) + " ");
            Console.WriteLine(Show(a & true) + " " + Show(false | a) + " " + Show(!a));
        }
        bool? x = null, y = false;
        x &= y;
        y |= x;
        bool known = true;
        Console.WriteLine(Show(x) + " " + Show(y) + " " + Show(known & (bool?)null) + " " + Show((bool?)null | known) + " " + ((x | known) == true));
    }
}
