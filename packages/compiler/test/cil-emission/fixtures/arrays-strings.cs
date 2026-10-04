using System;

class Program
{
    static void Main()
    {
        int[] numbers = new int[5];
        for (int i = 0; i < numbers.Length; i++) numbers[i] = i * i;
        numbers[2] += 10;
        numbers[3]++;
        int sum = 0;
        foreach (int value in numbers) sum += value;
        Console.WriteLine(sum);
        string[] names = { "ann", "bob", "eve" };
        foreach (string name in names) Console.WriteLine(name.Length + ":" + name);
        double[] ratios = new double[] { 0.5, 1.5 };
        Console.WriteLine(ratios[0] + ratios[1]);
        long[] wide = new long[2];
        wide[1] = 5000000000;
        Console.WriteLine(wide[0] + wide[1]);
        bool[] flags = new bool[3];
        flags[1] = true;
        Console.WriteLine(flags[0]);
        Console.WriteLine(flags[1]);
        char[] letters = { 'x', 'y' };
        Console.WriteLine(letters[1]);

        string text = "hello";
        Console.WriteLine(text + " " + "world");
        Console.WriteLine(text.Length);
        Console.WriteLine(text[1]);
        Console.WriteLine(text == "hello");
        Console.WriteLine(text != "hello");
        string built = "";
        foreach (char c in text) built = c + built;
        Console.WriteLine(built);
        int count = 3;
        double price = 2.5;
        Console.WriteLine($"{count} items at {price} each");
        Console.WriteLine($"[{count,4}] [{text,-7}] done");
        Console.WriteLine("total: " + count * price);
        Console.WriteLine(text.ToUpper() + text.Substring(1, 3));
        string nothing = null;
        Console.WriteLine("a" + nothing + "b");
    }
}
