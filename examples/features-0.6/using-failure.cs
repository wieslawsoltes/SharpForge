Lease Fail() { throw new Exception("acquisition failed"); }
try
{
    using Lease outer = new Lease("outer"), inner = Fail();
}
catch (Exception error) { Console.WriteLine(error.Message); }
using (Lease missing = null) { Console.WriteLine("null skipped"); }
class Lease : IDisposable
{
    public string Name { get; }
    public Lease(string name) { Name = name; Console.WriteLine("acquire " + name); }
    public void Dispose() { Console.WriteLine("dispose " + Name); }
}
