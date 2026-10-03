// A source-debuggable PE/CLI example for the SharpForge browser runtime.
class Accumulator
{
    public int Total;
    public void Add(int value)
    {
        Total += value;
    }
}

class Program
{
    static void Main()
    {
        int[] values = new int[] { 6, 7, 11, 18 };
        var accumulator = new Accumulator();
        foreach (int value in values)
        {
            accumulator.Add(value);
        }
        Console.WriteLine(accumulator.Total);
    }
}
