using System;

class Program
{
    static int Fibonacci(int n)
    {
        if (n < 2) return n;
        return Fibonacci(n - 1) + Fibonacci(n - 2);
    }

    static string Classify(int n)
    {
        if (n < 0) return "negative";
        else if (n == 0) return "zero";
        else if (n < 10 || n == 100) return "small";
        return "large";
    }

    static void Main()
    {
        for (int i = 0; i < 6; i++)
        {
            if (i == 1) continue;
            if (i == 4) break;
            Console.WriteLine(i);
        }
        int n = 3;
        while (n > 0)
        {
            Console.WriteLine(n);
            n--;
        }
        do
        {
            n += 2;
        } while (n < 5);
        Console.WriteLine(n);
        Console.WriteLine(Fibonacci(15));
        Console.WriteLine(Classify(-4));
        Console.WriteLine(Classify(0));
        Console.WriteLine(Classify(100));
        Console.WriteLine(Classify(55));
        int outer = 0;
        for (int i = 0; i < 4; i++)
        {
            for (int j = 0; j < 4; j++)
            {
                if (j > i) break;
                outer += i * j;
            }
        }
        Console.WriteLine(outer);
        bool flag = n > 2 && Fibonacci(5) == 5 || false;
        Console.WriteLine(flag);
        string text = n > 100 ? "big" : n > 4 ? "medium" : "small";
        Console.WriteLine(text);
        string missing = null;
        Console.WriteLine(missing ?? "fallback");
    }
}
