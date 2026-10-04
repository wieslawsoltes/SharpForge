using System;
using System.Collections.Generic;
using System.Numerics;

// Reduced from stress-language/primary-constructors-extensions: a property of a C# 14 extension block with type
// parameters is a static accessor that takes the receiver by value - also when the receiver is a struct or a constant.
public static class NumberExtensions
{
    extension<T>(T value) where T : INumber<T>
    {
        public T Squared => value * value;
        public bool IsBetween(T low, T high) => value >= low && value <= high;
        public T Halved
        {
            get => value / (T.One + T.One);
        }
    }

    extension<T>(IEnumerable<T> source)
    {
        public bool IsEmpty
        {
            get
            {
                foreach (T item in source) return false;
                return true;
            }
        }
    }

    extension(string text)
    {
        public int Vowels
        {
            get
            {
                int count = 0;
                foreach (char c in text) if ("aeiou".IndexOf(c) >= 0) count++;
                return count;
            }
        }
    }
}

public static class Program
{
    private struct Stock
    {
        public int Units;
    }

    public static void Main()
    {
        var stock = new Stock { Units = 6 };
        decimal price = 2.5m;
        int[] none = new int[0];
        Console.WriteLine(7.Squared + " " + (1.5.Squared == 2.25) + " " + stock.Units.Squared + " " + price.Squared + " " + ((byte)20).Squared);
        Console.WriteLine(12L.IsBetween(10, 20) + " " + price.Halved + " " + 9.Halved + " " + stock.Units.Halved.Squared);
        Console.WriteLine(none.IsEmpty + " " + new List<string> { "a" }.IsEmpty + " " + "education".Vowels);
    }
}
