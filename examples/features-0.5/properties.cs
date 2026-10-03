var counter = new Counter();
Console.WriteLine(counter.Value);
counter.Add(2);
Console.WriteLine(counter.Doubled);
Console.WriteLine(counter.Value);
class Counter
{
    public int Value { get; private set; } = 7;
    public int Doubled => Value * 2;
    public void Add(int amount) { Value += amount; }
}
