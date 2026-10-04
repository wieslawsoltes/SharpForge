using System;

class Program
{
    static int Sum(int[] values)
    {
        int total = 0;
        for (int i = 0; i < values.Length; i++) total += values[i];
        return total;
    }

    static void Main()
    {
        int a = 17, b = 5;
        Console.WriteLine(a + b);
        Console.WriteLine(a - b);
        Console.WriteLine(a * b);
        Console.WriteLine(a / b);
        Console.WriteLine(a % b);
        Console.WriteLine(-a);
        Console.WriteLine(a << 3);
        Console.WriteLine(-a >> 2);
        Console.WriteLine(a & b);
        Console.WriteLine(a | b);
        Console.WriteLine(a ^ b);
        Console.WriteLine(~a);

        long big = 3000000000L * 2;
        Console.WriteLine(big);
        Console.WriteLine(big / 7);
        Console.WriteLine(big % 1000);

        uint u = 4000000000;
        Console.WriteLine(u / 3);
        Console.WriteLine(u > 5);
        Console.WriteLine(u >> 4);

        double d = 7.5;
        Console.WriteLine(d * 2);
        Console.WriteLine(d / 2);
        Console.WriteLine(d > 7);
        Console.WriteLine(a / 2.0);

        byte small = 250;
        small += 10;
        Console.WriteLine(small);
        short narrow = (short)(a * 4000);
        Console.WriteLine(narrow);
        Console.WriteLine((int)(d + 0.49));
        Console.WriteLine((long)a * 1000000000);
        Console.WriteLine((double)a / b);
        Console.WriteLine((byte)(a + 283));
        Console.WriteLine((uint)(-a));
        Console.WriteLine((char)(a + 48));

        bool yes = a > b, no = a == b;
        Console.WriteLine(yes && !no);
        Console.WriteLine(yes ^ no);
        Console.WriteLine(yes | no);

        int counter = 0;
        counter++;
        ++counter;
        int old = counter--;
        Console.WriteLine(old);
        Console.WriteLine(counter);
        counter *= 6;
        counter -= 1;
        counter <<= 2;
        Console.WriteLine(counter);

        Console.WriteLine(Sum(new int[] { 1, 2, 3, 4 }));
        Console.WriteLine(a > b ? a : b);
        Console.WriteLine(int.MaxValue);
        Console.WriteLine(long.MinValue);
    }
}
