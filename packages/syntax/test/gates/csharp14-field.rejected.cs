// langversion 13: expect the language-version diagnostics recorded in the .roslyn.json beside this file
class C
{
    int field;
    public int A { get => field; set => field = value; }
    public int B { get { return this.field; } set { @field = value; } }
    public int G => field;
    int M() => field;
}
class D
{
    public int A { get => field; set => field = value; }
}
