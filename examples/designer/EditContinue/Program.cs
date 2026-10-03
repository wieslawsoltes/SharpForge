class Counter
{
    public int Value = 40;
}
class Program
{
    static int Adjust(int value) { return value + 2; }
    static void Main()
    {
        Counter counter = new Counter();
        int value = counter.Value;
        value++;
        Console.WriteLine(Adjust(value));
    }
}
