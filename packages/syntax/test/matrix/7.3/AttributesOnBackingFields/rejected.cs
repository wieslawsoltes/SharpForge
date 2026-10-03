// langversion 7.2: expect CS8371 at 15 "field:"
class C
{
    [field: System.NonSerialized]
    public int P { get; set; }
}
