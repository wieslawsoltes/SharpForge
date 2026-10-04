var row = new Row();
GC.Collect();
Console.WriteLine(row.Value);
class Row
{
    public int Value { get; set; } = 42;
    public int Unsafe { get { throw new Exception("Watches must not execute this getter"); } }
}
