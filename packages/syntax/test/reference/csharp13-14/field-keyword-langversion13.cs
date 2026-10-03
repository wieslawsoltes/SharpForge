// roslyn: langversion=13
class C
{
    int field;
    public int A { get => field; set => field = value; }
    public int B { get { return field; } set { field = value; } }
    public int G => field;
}
