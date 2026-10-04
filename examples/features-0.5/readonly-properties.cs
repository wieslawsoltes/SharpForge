var record = new Record("Ada", 42);
Console.WriteLine(record.Name);
Console.WriteLine(record.Id);
class Record
{
    public string Name { get; }
    public int Id { get; }
    public Record(string name, int id) { Name = name; Id = id; }
}
