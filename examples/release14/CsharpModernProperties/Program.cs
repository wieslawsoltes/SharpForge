using System;
class Reading
{
    public int Value { get; set { field = Math.Clamp(value, 0, 100); } }
}
class Program
{
    static int calls;
    static int Measure() { calls++; return 99; }
    static void Main()
    {
        Reading live = new() { Value = 42 };
        Reading missing = null;
        missing?.Value = Measure();
        Console.WriteLine(live.Value);
        Console.WriteLine(calls);
    }
}
