class Ledger
{
    public int Value;
    public Ledger(int value) { Value = value; }
    public int Add(int amount) { Value += amount; return Value; }
    public int Doubled { get { return Value * 2; } }
}
class Program
{
    static void Main()
    {
        var ledger = new Ledger(40);
        Console.WriteLine(ledger.Value);
    }
}
