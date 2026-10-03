class C
{
    int f;
    int M() { return 1; } => 2;
    void N() { } => f++;
    C() { f = 1; } => f = 2;
    C(int a) : this() { } => f = a;
    ~C() { } => f = 0;
    static C() { } => System.Console.WriteLine();
    public static C operator +(C a, C b) { return a; } => b;
    public static implicit operator int(C c) { return 1; } => 2;
    int P { get { return 1; } => 2; set { f = value; } => f = value; }
    int Q { get { return 1; } } => 2;
    int R { get; } => 3;
    int this[int i] { get { return i; } => i; }
    int this[long i] { get { return 1; } } => 2;
    event System.Action E { add { } => f++; remove { } => f--; }
    int L()
    {
        int Local() { return 1; } => 2;
        static int Other(int a) { return a; } => a;
        return Local();
    }
    async System.Threading.Tasks.Task<int> A() { return await A(); } => await A();
}
interface I
{
    int M() { return 1; } => 2;
}
