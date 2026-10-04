int Work()
{
    using var outer = new Lease("outer");
    using (var inner = new Lease("inner"))
    {
        Console.WriteLine("body");
        return 42;
    }
}
Console.WriteLine(Work());
class Lease : IDisposable
{
    public string Name { get; }
    public Lease(string name) { Name = name; Console.WriteLine("acquire " + name); }
    public void Dispose() { Console.WriteLine("dispose " + Name); }
}
