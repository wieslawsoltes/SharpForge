using System;

delegate int Operation(int value);

class Accumulator(int step, string label)
{
    int total;

    public int Next()
    {
        total += step;
        return total;
    }

    public string Label => label + ":" + total;

    public void Faster()
    {
        step *= 2;
    }

    public Func<int> Reader()
    {
        return () => total + step;
    }
}

class Program
{
    static int Twice(int value)
    {
        return value * 2;
    }

    static void Main()
    {
        int[] numbers = { 1, 2, 3, 4 };
        Console.WriteLine(numbers[^1] + numbers[^2]);
        numbers[^1] = 40;
        numbers[^4] += 10;
        Console.WriteLine(numbers[0] + numbers[3]);
        int back = 3;
        Console.WriteLine(numbers[^back]);
        string text = "hello";
        Console.WriteLine(text[^1]);
        Console.WriteLine(text[1..3]);
        Console.WriteLine(text[..2] + text[3..]);
        Console.WriteLine(text[1..^1]);
        Console.WriteLine(text[^3..]);

        var accumulator = new Accumulator(3, "acc");
        accumulator.Next();
        Console.WriteLine(accumulator.Next());
        accumulator.Faster();
        Console.WriteLine(accumulator.Next());
        Console.WriteLine(accumulator.Label);
        Console.WriteLine(accumulator.Reader()());

        Operation twice = new Operation(Twice);
        Operation plusOne = new Operation(value => value + 1);
        Console.WriteLine(twice(4) + plusOne(4));
        Action<int, string> ignoring = delegate { Console.WriteLine("called"); };
        ignoring(1, "x");
    }
}
