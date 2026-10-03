class C
{
    int f;
    int M() { return 1; } => 2
    C() { } => f = 2
    int P { get { return 1; } => 2 }
    int this[int i] { get { return i; } } => i
    int L()
    {
        int Local() { return 1; } => 2
        return Local();
    }
    void K() { } => ;
}
