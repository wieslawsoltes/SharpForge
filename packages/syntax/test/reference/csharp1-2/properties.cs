abstract class Props
{
    int x;
    public int A { get { return x; } set { x = value; } }
    public int B { get; protected set; }
    public int C { private get; set; }
    public int D { get; internal set; }
    public int E { protected internal get; set; }
    public abstract int F { get; set; }
    public abstract int G { get; }
    public extern int H { get; set; }
    public virtual int I { get { return x; } }
    public static int J { set { } }
    protected int K { [Obsolete] get { return 1; } [param: NotNull] private set { } }
    public int this[int i] { get { return x; } set { x = value; } }
    public int this[int i, string s] { get { return i; } protected set { } }
    public abstract int this[long l] { get; set; }
    int IFace.L { get { return 1; } }
    int IFace.this[int i] { get { return i; } }
    string IGeneric<int>.Name { get { return null; } set { } }
    public new int M { get; set; }
    public override sealed int N { get { return 0; } }
    public int O { get; set; } public int P { get; }
    public extern int this[char c] { get; }
    internal static extern string Q { get; private set; }
    public System.Collections.Generic.List<int> R { get { return null; } }
}
