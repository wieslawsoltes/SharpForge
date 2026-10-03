using System;

class Program
{
    static int Fibonacci(int n)
    {
        if (n < 2)
        {
            return n;
        }
        return Fibonacci(n - 1) + Fibonacci(n - 2);
    }

    static void Main()
    {
        int count = 10;
        for (int i = 0; i < count; i++)
        {
            int value = Fibonacci(i);
            Console.WriteLine("fib(" + i + ") = " + value);
        }
    }
}
