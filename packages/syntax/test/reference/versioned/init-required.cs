class Person
{
    public required string Name { get; init; }
    public required int Age;
    required internal string Tag { get; set; }
    public int Id { get; private init; }
    public string Label { get => label; init => label = value; }
    public int Count { get { return count; } init { count = value; } }
    public string this[int i] { get => label; init { } }
    string label = "";
    int count;
    int required = 0;
    int init = 0;
    void M()
    {
        var init = 1;
        var required = 2;
        init = required + this.init + this.required;
        var p = new Person { Name = "n", Age = 3 };
    }
    int get() => init;
    int set(int init, int required) => init + required;
}
struct S
{
    public required readonly int X { get; init; }
    public required static int Y;
}
