// langversion 7.3: expect the language-version diagnostics recorded in the .roslyn.json beside this file
interface I
{
    void A();
    void B() { }
    int C() => 1;
    int P { get; }
    int Q { get => 1; set { } }
    int R => 2;
    public void D();
    private void E() { }
    static void K() { }
    static int L = 1;
    const int N = 3;
    virtual void O() { }
    abstract void S();
    sealed void T() { }
    class Nested { }
    event System.Action Ev;
    int this[int i] { get => i; }
    int this[string s] { get; set; }
    static I() { }
    public static I operator +(I a, I b) => a;
    enum NestedEnum { A }
    delegate void NestedDelegate();
    interface INested { }
    struct NestedStruct { }
    event System.Action Ev2 { add { } remove { } }
    public int U { get; set; }
    public abstract int V { get; }
    internal protected void W();
    new void X();
    unsafe void Y(int* p);
    extern void Z();
    partial void Z2();
    public event System.Action Ev3;
    static event System.Action Ev4;
    int I2.Explicit() => 1;
    public int this[long l] { get; }
}
struct S
{
    int x;
    public readonly int A() => 1;
    public readonly int P => 1;
    public int R { readonly get => 1; set { } }
    public readonly int this[int i] => i;
    public readonly event System.Action E { add { } remove { } }
    public static readonly int F = 1;
    readonly int G;
}
