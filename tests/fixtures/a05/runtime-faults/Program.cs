using System;

class Program
{
    static void Main()
    {
        int zero = 0;
        try { Console.WriteLine(1 / zero); }
        catch (DivideByZeroException) { Console.WriteLine("ok"); }
        try { Console.WriteLine(1 / zero); }
        catch (ArithmeticException) { Console.WriteLine("arithmetic"); }
        try { Console.WriteLine(1 / zero); }
        catch (SystemException) { Console.WriteLine("system"); }
        try { Console.WriteLine(1 / zero); }
        catch (Exception) { Console.WriteLine("exception"); }
    }
}
