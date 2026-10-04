using System;

delegate int Operation(int left, int right);

class Scaler
{
    readonly int factor;

    public Scaler(int factor)
    {
        this.factor = factor;
    }

    public int Scale(int value)
    {
        return value * factor;
    }

    public Func<int, int> Combined(int extra)
    {
        return value => Scale(value) + extra + factor;
    }
}

class Program
{
    static int Twice(int value)
    {
        return value * 2;
    }

    static int Apply(Operation operation, int left, int right)
    {
        return operation(left, right);
    }

    static Func<int> Counter(int start)
    {
        int count = start;
        return () => ++count;
    }

    static int Sum(int[] values, Func<int, bool> filter)
    {
        int total = 0;
        foreach (int value in values)
            if (filter(value)) total += value;
        return total;
    }

    static void Main()
    {
        Operation add = (left, right) => left + right;
        Console.WriteLine(add(2, 3));
        Console.WriteLine(Apply((left, right) => left * right, 4, 5));
        Console.WriteLine(Apply(delegate (int left, int right) { return left - right; }, 9, 5));

        Func<int, int> twice = Twice;
        Console.WriteLine(twice(21));
        var scaler = new Scaler(3);
        Func<int, int> scale = scaler.Scale;
        Console.WriteLine(scale(5));
        Console.WriteLine(scaler.Combined(100)(2));

        int limit = 10;
        Func<int, bool> below = value => value < limit;
        Console.WriteLine(Sum(new int[] { 5, 15, 8 }, below));
        limit = 20;
        Console.WriteLine(Sum(new int[] { 5, 15, 8 }, below));

        Func<int> counter = Counter(5);
        counter();
        Console.WriteLine(counter());
        Console.WriteLine(Counter(100)());

        int shared = 0;
        Action bump = () => { shared += 2; };
        bump();
        bump();
        Console.WriteLine(shared);

        var actions = new Action[3];
        for (int i = 0; i < 3; i++)
        {
            int copy = i;
            actions[i] = () => Console.WriteLine("copy " + copy);
        }
        foreach (Action action in actions) action();
        var readers = new Func<int>[3];
        int index = 0;
        foreach (int item in new int[] { 7, 8, 9 })
        {
            readers[index++] = () => item;
        }
        Console.WriteLine(readers[0]() + readers[1]() + readers[2]());

        int Factorial(int n) => n <= 1 ? 1 : n * Factorial(n - 1);
        Console.WriteLine(Factorial(6));
        int AddLimit(int value)
        {
            return value + limit;
        }
        Console.WriteLine(AddLimit(1));
        static int Square(int value) => value * value;
        Console.WriteLine(Square(9));
        Func<int, int> local = AddLimit;
        Console.WriteLine(local(2));

        Func<int, Func<int, int>> adder = first => second => first + second + shared;
        Console.WriteLine(adder(1)(2));
        Action<string> print = text => Console.WriteLine("print " + text);
        print("done");
    }
}
