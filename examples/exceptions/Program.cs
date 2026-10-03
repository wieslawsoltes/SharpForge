using System;

class Program
{
    static int Divide(int numerator, int denominator)
    {
        return numerator / denominator;
    }

    static void Main()
    {
        try
        {
            int divisor = 0;
            int result = Divide(42, divisor);
            Console.WriteLine(result);
        }
        catch (Exception error)
        {
            Console.WriteLine("Caught: " + error.Message);
        }
        Console.WriteLine("Execution recovered safely.");
    }
}
