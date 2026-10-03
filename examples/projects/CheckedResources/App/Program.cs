using var lease = new Lease();
int maximum = 2147483647;
try { Console.WriteLine(maximum + 1); }
catch (Exception error) { Console.WriteLine("checked project"); }
Console.WriteLine(Arithmetic.Wrapped());
class Lease : IDisposable
{
    public void Dispose() { Console.WriteLine("disposed"); }
}
