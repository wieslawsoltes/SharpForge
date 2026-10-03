interface I
{
    void A();
    void B() { }
    int C() => 1;
    int P { get; }
    int Q { get => 1; set { } }
    int R => 2;
    public void D() { }
    private void E() { }
    protected void F() { }
    internal void G() { }
    protected internal void H() { }
    private protected void J() { }
    static void K() { }
    public static int L = 1;
    private static readonly int M = 2;
    const int N = 3;
    virtual void O() { }
    abstract void S();
    sealed void T() { }
    extern void U();
    static I() { }
    public static I operator +(I a, I b) => a;
    static abstract void V();
    static virtual void W() { }
    partial void X();
    class Nested { }
    struct NestedStruct { }
    interface INested { }
    enum NestedEnum { A }
    delegate void NestedDelegate();
    event System.Action Ev;
    event System.Action Ev2 { add { } remove { } }
    int this[int i] { get => i; }
    int this[string s] { get; set; }
    void I2.Explicit() { }
    int I2.Prop => 1;
    unsafe void Y(int* p) { }
    async System.Threading.Tasks.Task Z() { await x; }
    new void A2();
}
struct S
{
    public readonly int A() => 1;
    public readonly int P => 1;
    public readonly int Q { get => 1; }
    public int R { readonly get => 1; set { } }
    public int T { get; readonly set; }
    public readonly int this[int i] => i;
    public readonly override string ToString() => "";
    public readonly event System.Action E { add { } remove { } }
    readonly void B() { }
    public static readonly int F = 1;
    readonly int G;
    int H { readonly get; set; }
    public readonly ref readonly int K() => ref x;
}
class C
{
    void M()
    {
        static int A(int x) => x;
        static async System.Threading.Tasks.Task B() { await x; }
        static T G<T>(T t) => t;
        static void V() { }
        unsafe static void U() { }
    }
}
