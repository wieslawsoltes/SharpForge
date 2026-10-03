class Lease : IDisposable
{
    public string Name { get; }
    public Lease(string name) { Name = name; Console.WriteLine("acquire " + name); }
    public void Dispose() { Console.WriteLine("dispose " + Name); }
}
int Select(int value)
{
    if (value > 0) { return 42; }
    else { return 0; }
}
class Printer { public static void Print(int value) { Console.WriteLine(value); } }
int amount = 7;
using (var lease = new Lease("local"))
{
    Printer.Print(Select(amount));
}
Console.WriteLine("after");
