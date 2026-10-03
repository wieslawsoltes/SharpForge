class C
{
    public int A { get => field; set => field = value; }
    public int B { get { return field; } set { field = value; } }
    public int D { get; set => field = value < 0 ? 0 : value; }
    public int E { get => field; init => field = value; }
    public string F { get => field ?? "none"; set; } = "x";
    public int G => field;
    public int H { get => field + 1; }
    public int I { get { var x = field; field++; return field.GetHashCode(); } }
    public int J { get { int Local() => field; return Local(); } }
    public int K { get { Func<int> f = () => field; return f(); } }
    public int L { get => this.field; set => @field = value; }
    public int M { get => nameof(field).Length; }
    public int N { get { var o = new T { field = 1 }; return o.field; } }
    public int O { get => field.x.y; set => field.x = value; }
    public int P { get => F(field, ref field, out field); }
    public static int Q { get => field; set => field = value; }
    public int this[int i] { get => field; set => field = value; }
    public event System.Action Ev { add { field = value; } remove { field = null; } }
    int field;
    int M2() => field;
    void M3() { int field = 1; field++; var y = field; }
    int M4(int field) => field;
    public int R { get { int field = 0; return field; } }
    public int S { get => field is var field2 ? field2 : 0; }
    public int T2 { get => C.field; }
    public int U { get => field!; set => field = value!; }
    public int V { get => (field); }
    public int W { get => field[0]; }
    public int X { get => field(); }
    public int Y { get => field?.Length ?? 0; }
    public int Z { [A(field)] get => 0; }
}
